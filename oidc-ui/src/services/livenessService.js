import axios from 'axios';

const ATTEMPT_STATUS = {
  CREATED: 'CREATED',
  LIVENESS_PASSED: 'LIVENESS_PASSED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CONSUMED: 'CONSUMED',
};

const getBaseUrl = () => {
  if (process.env.REACT_APP_BIOMETRIC_API_URL) {
    return process.env.REACT_APP_BIOMETRIC_API_URL;
  }
  if (typeof window !== 'undefined' && window.origin) {
    return window.origin;
  }
  return '';
};

const livenessClient = axios.create({
  withCredentials: true,
});

/**
 * Creates a Face Liveness attempt. The Biometric Service generates attemptId.
 * @param {string} transactionId eSignet OIDC transaction id
 * @param {string} trn Taxpayer Registration Number
 * @returns {Promise<{attemptId: string, sessionId: string, credentials: object}>}
 */
const createAttempt = async (transactionId, trn) => {
  const response = await livenessClient.post(`${getBaseUrl()}/attempts`, {
    transactionId,
    trn,
  });
  return response.data;
};

/**
 * Completes a Face Liveness attempt after Amplify onAnalysisComplete.
 * @param {string} attemptId id returned by createAttempt
 * @param {string} transactionId same eSignet transaction id used at create
 * @returns {Promise<{attemptId: string, status: string, failureCode: string|null}>}
 */
const completeAttempt = async (attemptId, transactionId) => {
  const response = await livenessClient.post(
    `${getBaseUrl()}/attempts/${attemptId}/complete`,
    { transactionId }
  );
  return response.data;
};

/**
 * Builds Amplify credentialProvider from POST /attempts credentials.
 * @param {object} credentials response.credentials from createAttempt
 * @returns {() => Promise<object>}
 */
const buildCredentialProvider = (credentials) => {
  return async () => ({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    expiration: credentials.expiration
      ? new Date(credentials.expiration)
      : undefined,
  });
};

export {
  ATTEMPT_STATUS,
  createAttempt,
  completeAttempt,
  buildCredentialProvider,
  getBaseUrl,
};
