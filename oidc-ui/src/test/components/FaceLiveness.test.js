import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FaceLiveness from '../../components/FaceLiveness';
import {
  ATTEMPT_STATUS,
  completeAttempt,
  createAttempt,
} from '../../services/livenessService';

jest.mock('../../services/livenessService', () => {
  const actual = jest.requireActual('../../services/livenessService');
  return {
    ...actual,
    createAttempt: jest.fn(),
    completeAttempt: jest.fn(),
  };
});

jest.mock('@aws-amplify/ui-react-liveness', () => ({
  FaceLivenessDetector: () => null,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en' },
  }),
}));

jest.mock('../../helpers/redirectOnError', () => jest.fn());

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const MockLivenessDetector = ({ onAnalysisComplete, onError, onUserCancel }) => (
  <div data-testid="mock-face-liveness-detector">
    <button type="button" onClick={() => onAnalysisComplete()}>
      complete-analysis
    </button>
    <button type="button" onClick={() => onError(new Error('camera'))}>
      trigger-error
    </button>
    <button type="button" onClick={() => onUserCancel()}>
      cancel-capture
    </button>
  </div>
);

describe('FaceLiveness', () => {
  const post_AuthenticateUser = jest.fn();
  const buildRedirectParamsV2 = jest.fn(() => '?nonce=1');

  const openIDConnectService = {
    getTransactionId: () => 'txn-1',
    getNonce: () => 'nonce',
    getState: () => 'state',
    getOAuthDetails: () => ({ clientId: 'client' }),
  };

  const authService = {
    post_AuthenticateUser,
    buildRedirectParamsV2,
  };

  const createdAttempt = {
    attemptId: 'attempt-1',
    sessionId: 'session-1',
    credentials: {
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      sessionToken: 'token',
      region: 'eu-west-1',
    },
  };

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <FaceLiveness
          authService={authService}
          openIDConnectService={openIDConnectService}
          backButtonDiv={<div>back</div>}
          secondaryHeading="login_with_id"
          LivenessDetectorComponent={MockLivenessDetector}
        />
      </MemoryRouter>
    );

  const startCapture = async () => {
    fireEvent.change(screen.getByLabelText('trn_label'), {
      target: { value: '123456789' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'start_liveness' }));
    await waitFor(() => {
      expect(createAttempt).toHaveBeenCalled();
    });
    expect(
      await screen.findByTestId('mock-face-liveness-detector')
    ).toBeInTheDocument();
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not call createAttempt when TRN is invalid', async () => {
    renderComponent();

    fireEvent.change(screen.getByLabelText('trn_label'), {
      target: { value: 'abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'start_liveness' }));

    expect(createAttempt).not.toHaveBeenCalled();
  });

  test('TRN input keeps digits only and caps at 9 characters', () => {
    renderComponent();

    fireEvent.change(screen.getByLabelText('trn_label'), {
      target: { value: '12ab34567890123' },
    });

    expect(screen.getByLabelText('trn_label')).toHaveValue('123456789');
  });

  test('create failure shows faceLiveness-prefixed banner key', async () => {
    createAttempt.mockRejectedValue({
      response: { data: { code: 'UNKNOWN_BACKEND_CODE' } },
    });

    renderComponent();
    fireEvent.change(screen.getByLabelText('trn_label'), {
      target: { value: '123456789' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'start_liveness' }));

    await waitFor(() => {
      expect(screen.getByText('faceLiveness.attempt_create_failed')).toBeInTheDocument();
    });
  });

  test('createAttempt body is transactionId and trn; attemptId comes from response', async () => {
    createAttempt.mockResolvedValue({
      ...createdAttempt,
      attemptId: 'attempt-from-service',
    });

    renderComponent();
    await startCapture();

    expect(createAttempt).toHaveBeenCalledWith('txn-1', '123456789');
  });

  test('onAnalysisComplete calls complete and not authenticate when LIVENESS_PASSED', async () => {
    createAttempt.mockResolvedValue(createdAttempt);
    completeAttempt.mockResolvedValue({
      attemptId: 'attempt-1',
      status: ATTEMPT_STATUS.LIVENESS_PASSED,
      failureCode: null,
    });

    renderComponent();
    await startCapture();
    fireEvent.click(screen.getByText('complete-analysis'));

    await waitFor(() => {
      expect(completeAttempt).toHaveBeenCalledWith('attempt-1', 'txn-1');
    });
    expect(post_AuthenticateUser).not.toHaveBeenCalled();
    expect(await screen.findByTestId('liveness-passed')).toBeInTheDocument();
  });

  test('APPROVED calls authenticate with FLV challenge attemptId and TRN individualId', async () => {
    createAttempt.mockResolvedValue({
      ...createdAttempt,
      attemptId: 'attempt-approved',
    });
    completeAttempt.mockResolvedValue({
      attemptId: 'attempt-approved',
      status: ATTEMPT_STATUS.APPROVED,
      failureCode: null,
    });
    post_AuthenticateUser.mockResolvedValue({
      response: { consentAction: 'CAPTURE' },
      errors: null,
    });

    renderComponent();
    await startCapture();
    fireEvent.click(screen.getByText('complete-analysis'));

    await waitFor(() => {
      expect(post_AuthenticateUser).toHaveBeenCalledWith('txn-1', '123456789', [
        {
          authFactorType: 'FLV',
          challenge: 'attempt-approved',
          format: 'alpha-numeric',
        },
      ]);
    });
  });

  test('REJECTED does not call authenticate', async () => {
    createAttempt.mockResolvedValue(createdAttempt);
    completeAttempt.mockResolvedValue({
      attemptId: 'attempt-1',
      status: ATTEMPT_STATUS.REJECTED,
      failureCode: 'LOW_CONFIDENCE',
    });

    renderComponent();
    await startCapture();
    fireEvent.click(screen.getByText('complete-analysis'));

    await waitFor(() => {
      expect(completeAttempt).toHaveBeenCalled();
    });
    expect(post_AuthenticateUser).not.toHaveBeenCalled();
  });

  test('camera error does not call authenticate', async () => {
    createAttempt.mockResolvedValue(createdAttempt);

    renderComponent();
    await startCapture();
    fireEvent.click(screen.getByText('trigger-error'));

    await waitFor(() => {
      expect(screen.getByLabelText('trn_label')).toBeInTheDocument();
    });
    expect(post_AuthenticateUser).not.toHaveBeenCalled();
    expect(completeAttempt).not.toHaveBeenCalled();
  });
});
