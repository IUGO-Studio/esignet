import axios from 'axios';
import {
  ATTEMPT_STATUS,
  buildCredentialProvider,
  completeAttempt,
  createAttempt,
  getBaseUrl,
} from '../../services/livenessService';

jest.mock('axios', () => {
  const post = jest.fn();
  return {
    create: jest.fn(() => ({ post })),
    __mockPost: post,
  };
});

const mockPost = axios.__mockPost;

describe('livenessService', () => {
  beforeEach(() => {
    mockPost.mockReset();
    delete process.env.REACT_APP_BIOMETRIC_API_URL;
  });

  test('ATTEMPT_STATUS exposes expected values', () => {
    expect(ATTEMPT_STATUS.APPROVED).toBe('APPROVED');
    expect(ATTEMPT_STATUS.LIVENESS_PASSED).toBe('LIVENESS_PASSED');
    expect(ATTEMPT_STATUS.REJECTED).toBe('REJECTED');
  });

  test('getBaseUrl prefers REACT_APP_BIOMETRIC_API_URL', () => {
    process.env.REACT_APP_BIOMETRIC_API_URL = 'http://biometric:8080';
    expect(getBaseUrl()).toBe('http://biometric:8080');
  });

  test('createAttempt posts transactionId and trn only', async () => {
    mockPost.mockResolvedValue({
      data: {
        attemptId: 'attempt-1',
        sessionId: 'session-1',
        credentials: {
          accessKeyId: 'AKIA',
          secretAccessKey: 'secret',
          sessionToken: 'token',
          expiration: '2099-01-01T00:00:00Z',
          region: 'eu-west-1',
        },
      },
    });

    const result = await createAttempt('txn-1', '123456789');

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/attempts$/),
      { transactionId: 'txn-1', trn: '123456789' }
    );
    expect(result.attemptId).toBe('attempt-1');
    expect(result.sessionId).toBe('session-1');
  });

  test('completeAttempt posts attemptId in path and transactionId in body', async () => {
    mockPost.mockResolvedValue({
      data: {
        attemptId: 'attempt-1',
        status: 'APPROVED',
        failureCode: null,
      },
    });

    const result = await completeAttempt('attempt-1', 'txn-1');

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/attempts\/attempt-1\/complete$/),
      { transactionId: 'txn-1' }
    );
    expect(result.status).toBe('APPROVED');
  });

  test('buildCredentialProvider returns Amplify credentials', async () => {
    const provider = buildCredentialProvider({
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      sessionToken: 'token',
      expiration: '2099-01-01T00:00:00.000Z',
    });

    const credentials = await provider();
    expect(credentials.accessKeyId).toBe('AKIA');
    expect(credentials.secretAccessKey).toBe('secret');
    expect(credentials.sessionToken).toBe('token');
    expect(credentials.expiration).toBeInstanceOf(Date);
  });
});
