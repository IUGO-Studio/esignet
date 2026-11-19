import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FaceLiveness, {
  getAuthTransactionId,
} from '../../components/FaceLiveness';
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

const MockLivenessDetector = ({
  sessionId,
  onAnalysisComplete,
  onError,
  onUserCancel,
  config,
}) => (
  <div data-testid="mock-face-liveness-detector">
    <span data-testid="detector-session-id">{sessionId}</span>
    <span data-testid="detector-has-credentials">
      {typeof config?.credentialProvider === 'function' ? 'yes' : 'no'}
    </span>
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
    getEsignetConfiguration: () => '10',
  };

  // auth txn id for oidc "txn-1" with length 10 (AuthorizationServiceImpl algorithm)
  const expectedAuthTransactionId = getAuthTransactionId('txn-1', 10);

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
      response: { data: { error: 'UNKNOWN_BACKEND_CODE' } },
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

  test('createAttempt uses auth transactionId and trn; attemptId comes from response', async () => {
    createAttempt.mockResolvedValue({
      ...createdAttempt,
      attemptId: 'attempt-from-service',
    });

    renderComponent();
    await startCapture();

    expect(createAttempt).toHaveBeenCalledWith(
      expectedAuthTransactionId,
      '123456789'
    );
    expect(expectedAuthTransactionId).toBe('1nxt1nxt1n');
    // Amplify FaceLivenessDetector only reads STS from config.credentialProvider.
    expect(screen.getByTestId('detector-has-credentials')).toHaveTextContent(
      'yes'
    );
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
      expect(completeAttempt).toHaveBeenCalledWith(
        'attempt-1',
        expectedAuthTransactionId
      );
    });
    expect(post_AuthenticateUser).not.toHaveBeenCalled();
    expect(createAttempt).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('liveness-passed')).toBeInTheDocument();
  });

  test('APPROVED calls authenticate with FLV challenge attemptId and TRN individualId', async () => {
    createAttempt.mockResolvedValue({
      ...createdAttempt,
      attemptId: '11111111-1111-4111-8111-111111111111',
    });
    completeAttempt.mockResolvedValue({
      attemptId: '11111111-1111-4111-8111-111111111111',
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
          challenge: '11111111-1111-4111-8111-111111111111',
          format: 'uuid',
        },
      ]);
    });
    expect(createAttempt).toHaveBeenCalledTimes(1);
    expect(completeAttempt).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining('/claim-details'),
      { replace: true }
    );
  });

  test('REJECTED shows error, does not authenticate, and starts a new session', async () => {
    createAttempt
      .mockResolvedValueOnce(createdAttempt)
      .mockResolvedValueOnce({
        attemptId: 'attempt-2',
        sessionId: 'session-2',
        credentials: {
          ...createdAttempt.credentials,
        },
      });
    completeAttempt.mockResolvedValue({
      attemptId: 'attempt-1',
      status: ATTEMPT_STATUS.REJECTED,
      failureCode: 'LOW_CONFIDENCE',
    });

    renderComponent();
    await startCapture();
    fireEvent.click(screen.getByText('complete-analysis'));

    await waitFor(() => {
      expect(createAttempt).toHaveBeenCalledTimes(2);
    });
    expect(post_AuthenticateUser).not.toHaveBeenCalled();
    expect(createAttempt).toHaveBeenNthCalledWith(
      2,
      expectedAuthTransactionId,
      '123456789'
    );
    expect(
      await screen.findByText('faceLiveness.liveness_rejected')
    ).toBeInTheDocument();
    expect(await screen.findByTestId('detector-session-id')).toHaveTextContent(
      'session-2'
    );
  });

  test('REJECTED falls back to TRN when the new attempt create fails', async () => {
    createAttempt
      .mockResolvedValueOnce(createdAttempt)
      .mockRejectedValueOnce({
        response: { data: { error: 'AWS_UNAVAILABLE' } },
      });
    completeAttempt.mockResolvedValue({
      attemptId: 'attempt-1',
      status: ATTEMPT_STATUS.REJECTED,
      failureCode: 'LOW_CONFIDENCE',
    });

    renderComponent();
    await startCapture();
    fireEvent.click(screen.getByText('complete-analysis'));

    await waitFor(() => {
      expect(createAttempt).toHaveBeenCalledTimes(2);
    });
    expect(post_AuthenticateUser).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('trn_label')).toBeInTheDocument();
    expect(
      screen.getByText('faceLiveness.attempt_create_failed')
    ).toBeInTheDocument();
  });

  test('create failure reads Biometric Service error field', async () => {
    createAttempt.mockRejectedValue({
      response: { data: { error: 'AWS_UNAVAILABLE' } },
    });

    renderComponent();
    fireEvent.change(screen.getByLabelText('trn_label'), {
      target: { value: '123456789' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'start_liveness' }));

    await waitFor(() => {
      expect(
        screen.getByText('faceLiveness.attempt_create_failed')
      ).toBeInTheDocument();
    });
  });

  test('authenticate error clears capture and shows eSignet banner on TRN', async () => {
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
      response: null,
      errors: [{ errorCode: 'auth_failed' }],
    });

    renderComponent();
    await startCapture();
    fireEvent.click(screen.getByText('complete-analysis'));

    await waitFor(() => {
      expect(post_AuthenticateUser).toHaveBeenCalled();
    });
    expect(await screen.findByLabelText('trn_label')).toBeInTheDocument();
    expect(screen.getByText('errors.auth_failed')).toBeInTheDocument();
    expect(
      screen.queryByTestId('mock-face-liveness-detector')
    ).not.toBeInTheDocument();
  });

  test('authenticate network failure shows authentication_failed_msg on TRN', async () => {
    createAttempt.mockResolvedValue({
      ...createdAttempt,
      attemptId: 'attempt-approved',
    });
    completeAttempt.mockResolvedValue({
      attemptId: 'attempt-approved',
      status: ATTEMPT_STATUS.APPROVED,
      failureCode: null,
    });
    post_AuthenticateUser.mockRejectedValue(new Error('Network Error'));

    renderComponent();
    await startCapture();
    fireEvent.click(screen.getByText('complete-analysis'));

    await waitFor(() => {
      expect(post_AuthenticateUser).toHaveBeenCalled();
    });
    expect(await screen.findByLabelText('trn_label')).toBeInTheDocument();
    expect(
      screen.getByText('errors.authentication_failed_msg')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('faceLiveness.attempt_complete_failed')
    ).not.toBeInTheDocument();
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
