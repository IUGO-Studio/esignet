import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react-liveness/styles.css';
import LoadingIndicator from '../common/LoadingIndicator';
import ErrorBanner from '../common/ErrorBanner';
import {
  challengeFormats,
  challengeTypes,
  configurationKeys,
} from '../constants/clientConstants';
import { LoadingStates as states } from '../constants/states';
import redirectOnError from '../helpers/redirectOnError';
import {
  ATTEMPT_STATUS,
  buildCredentialProvider,
  completeAttempt,
  createAttempt,
} from '../services/livenessService';

const VIEW = {
  TRN: 'TRN',
  CAPTURE: 'CAPTURE',
  LIVENESS_PASSED: 'LIVENESS_PASSED',
};

const TRN_DIGITS_ONLY = /^\d+$/;
const TRN_MAX_LENGTH = 9;

/**
 * Derives the auth-transaction id that eSignet passes to Authenticator.doKycAuth.
 * Matches AuthorizationServiceImpl.getAuthTransactionId (and L1Biometrics).
 */
export const getAuthTransactionId = (oidcTransactionId, authTxnIdLength) => {
  if (!oidcTransactionId || !authTxnIdLength) {
    return '';
  }

  const normalized = oidcTransactionId.replace(/-|_/gi, '');
  if (!normalized.length) {
    return '';
  }

  let transactionId = '';
  let i = normalized.length - 1;
  while (transactionId.length < authTxnIdLength) {
    transactionId += normalized.charAt(i--);
    if (i < 0) {
      i = normalized.length - 1;
    }
  }
  return transactionId;
};

export default function FaceLiveness({
  authService,
  openIDConnectService,
  backButtonDiv,
  secondaryHeading,
  i18nKeyPrefix1 = 'faceLiveness',
  i18nKeyPrefix2 = 'errors',
  LivenessDetectorComponent = FaceLivenessDetector,
}) {
  const { t: t1, i18n } = useTranslation('translation', {
    keyPrefix: i18nKeyPrefix1,
  });
  const { t: t2 } = useTranslation('translation', {
    keyPrefix: i18nKeyPrefix2,
  });

  const navigate = useNavigate();
  const post_AuthenticateUser = authService.post_AuthenticateUser;
  const buildRedirectParams = authService.buildRedirectParamsV2;

  const authTxnIdLengthValue =
    openIDConnectService.getEsignetConfiguration?.(
      configurationKeys.authTxnIdLength
    ) ?? process.env.REACT_APP_AUTH_TXN_ID_LENGTH;
  const authTxnIdLength = parseInt(authTxnIdLengthValue, 10) || 10;

  const [view, setView] = useState(VIEW.TRN);
  const [trn, setTrn] = useState('');
  const [status, setStatus] = useState({ state: states.LOADED, msg: '' });
  const [errorBanner, setErrorBanner] = useState(null);
  const [attemptId, setAttemptId] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [region, setRegion] = useState(null);
  const [browserCredentials, setBrowserCredentials] = useState(null);

  const credentialProvider = useMemo(
    () =>
      browserCredentials ? buildCredentialProvider(browserCredentials) : null,
    [browserCredentials]
  );

  const clearCaptureState = () => {
    setAttemptId(null);
    setSessionId(null);
    setRegion(null);
    setBrowserCredentials(null);
  };

  const LOCAL_ERROR_KEYS = {
    invalid_trn: true,
    attempt_create_failed: true,
    attempt_complete_failed: true,
    liveness_rejected: true,
    liveness_capture_failed: true,
  };

  const showLocalError = (messageKey, fallbackKey = 'liveness_rejected') => {
    const key = LOCAL_ERROR_KEYS[messageKey] ? messageKey : fallbackKey;
    setErrorBanner({
      // ErrorBanner calls t(errorCode) from the root locale object.
      errorCode: `${i18nKeyPrefix1}.${key}`,
      show: true,
    });
  };

  /**
   * Biometric Service returns { error }; some stubs still use { code }.
   */
  const biometricErrorCode = (error) =>
    error?.response?.data?.error || error?.response?.data?.code;

  const handleTrnChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, TRN_MAX_LENGTH);
    setTrn(value);
    setErrorBanner(null);
  };

  const isTrnValid = () =>
    TRN_DIGITS_ONLY.test(trn) && trn.length === TRN_MAX_LENGTH;

  const getAuthTransactionIdForRequest = () => {
    const oidcTransactionId = openIDConnectService.getTransactionId();
    return getAuthTransactionId(oidcTransactionId, authTxnIdLength);
  };

  /**
   * Creates a Face Liveness attempt and mounts capture.
   * @param {{ clearError?: boolean }} options when clearError is false the
   * current banner (e.g. liveness_rejected) is kept across the new session.
   * @returns {Promise<boolean>} true when capture is ready
   */
  const createAndMountAttempt = async ({ clearError = true } = {}) => {
    const authTransactionId = getAuthTransactionIdForRequest();
    setStatus({ state: states.LOADING, msg: 'creating_attempt_msg' });
    if (clearError) {
      setErrorBanner(null);
    }

    try {
      const created = await createAttempt(authTransactionId, trn);
      setAttemptId(created.attemptId);
      setSessionId(created.sessionId);
      setRegion(created.credentials.region);
      setBrowserCredentials(created.credentials);
      setStatus({ state: states.LOADED, msg: '' });
      setView(VIEW.CAPTURE);
      return true;
    } catch (error) {
      setStatus({ state: states.LOADED, msg: '' });
      clearCaptureState();
      setView(VIEW.TRN);
      showLocalError(biometricErrorCode(error), 'attempt_create_failed');
      return false;
    }
  };

  const startAttempt = async () => {
    if (!isTrnValid()) {
      showLocalError('invalid_trn');
      return;
    }

    await createAndMountAttempt({ clearError: true });
  };

  const failAuthenticateToTrn = (errorCode) => {
    // Spent session must not remount; next Start creates a new attempt.
    clearCaptureState();
    setView(VIEW.TRN);
    setStatus({ state: states.LOADED, msg: '' });
    setErrorBanner({
      errorCode,
      show: true,
    });
  };

  const authenticateWithAttempt = async (approvedAttemptId) => {
    const transactionId = openIDConnectService.getTransactionId();
    const challengeList = [
      {
        authFactorType: challengeTypes.flv,
        challenge: approvedAttemptId,
        format: challengeFormats.flv,
      },
    ];

    setStatus({ state: states.LOADING, msg: 'authenticating_msg' });
    try {
      const authenticateResponse = await post_AuthenticateUser(
        transactionId,
        trn,
        challengeList
      );
      setStatus({ state: states.LOADED, msg: '' });

      const { response, errors } = authenticateResponse;

      if (errors !== null && errors.length > 0) {
        if (errors[0].errorCode === 'invalid_transaction') {
          redirectOnError(errors[0].errorCode, t2(`${errors[0].errorCode}`));
          return;
        }
        failAuthenticateToTrn(`${i18nKeyPrefix2}.${errors[0].errorCode}`);
        return;
      }

      setErrorBanner(null);
      const params = buildRedirectParams({
        nonce: openIDConnectService.getNonce(),
        state: openIDConnectService.getState(),
        oauthResponse: openIDConnectService.getOAuthDetails(),
        consentAction: response.consentAction,
        ui_locales: i18n.language,
      });

      navigate(process.env.PUBLIC_URL + '/claim-details' + params, {
        replace: true,
      });
    } catch (error) {
      failAuthenticateToTrn(`${i18nKeyPrefix2}.authentication_failed_msg`);
    }
  };

  const handleAnalysisComplete = async () => {
    const authTransactionId = getAuthTransactionIdForRequest();
    setStatus({ state: states.LOADING, msg: 'completing_attempt_msg' });
    setErrorBanner(null);

    try {
      const completed = await completeAttempt(attemptId, authTransactionId);

      if (completed.status === ATTEMPT_STATUS.APPROVED) {
        await authenticateWithAttempt(completed.attemptId || attemptId);
        return;
      }

      if (completed.status === ATTEMPT_STATUS.LIVENESS_PASSED) {
        setStatus({ state: states.LOADED, msg: '' });
        setView(VIEW.LIVENESS_PASSED);
        return;
      }

      // REJECTED / CONSUMED / other terminal: session is spent; show error and
      // open a new attempt (new sessionId) so Amplify can capture again.
      showLocalError('liveness_rejected');
      await createAndMountAttempt({ clearError: false });
    } catch (error) {
      setStatus({ state: states.LOADED, msg: '' });
      clearCaptureState();
      setView(VIEW.TRN);
      showLocalError(biometricErrorCode(error), 'attempt_complete_failed');
    }
  };

  const handleLivenessError = (error) => {
    // Amplify may pass { error } or a raw Error; surface it for debugging.
    console.error('Face Liveness capture error', error?.error || error);
    clearCaptureState();
    setView(VIEW.TRN);
    showLocalError('liveness_capture_failed');
  };

  const handleUserCancel = () => {
    clearCaptureState();
    setView(VIEW.TRN);
    setErrorBanner(null);
  };

  const handleRetry = () => {
    clearCaptureState();
    setView(VIEW.TRN);
    setErrorBanner(null);
  };

  const showCapture =
    status.state !== states.LOADING &&
    view === VIEW.CAPTURE &&
    sessionId &&
    region &&
    credentialProvider;

  return (
    <>
      <div className="flex items-center">
        {backButtonDiv}
        <div className="inline mx-2 font-semibold my-3">
          {t1(secondaryHeading, { currentID: t1('trn') })}
        </div>
      </div>

      {errorBanner !== null && (
        <ErrorBanner
          showBanner={errorBanner.show}
          errorCode={errorBanner.errorCode}
          onCloseHandle={() => setErrorBanner(null)}
        />
      )}

      {status.state === states.LOADING && (
        <div className="mt-4">
          <LoadingIndicator size="medium" message={t1(status.msg)} />
        </div>
      )}

      {status.state !== states.LOADING && view === VIEW.TRN && (
        <div className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="trn"
              className="block mb-1 text-sm font-medium text-gray-900"
            >
              {t1('trn_label')}
            </label>
            <input
              id="trn"
              name="trn"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={TRN_MAX_LENGTH}
              value={trn}
              onChange={handleTrnChange}
              placeholder={t1('trn_placeholder')}
              className="h-10 w-full border border-input bg-transparent px-3 py-2 text-sm rounded-md focus-visible:outline-none"
              aria-label={t1('trn_label')}
            />
          </div>
          <button
            type="button"
            id="start_liveness"
            className="flex justify-center w-full font-semibold rounded-md px-5 py-3 text-center border-2 primary-button"
            onClick={startAttempt}
            disabled={!isTrnValid()}
          >
            {t1('start_liveness')}
          </button>
        </div>
      )}

      {showCapture && (
        <div className="mt-4" data-testid="face-liveness-detector">
          <LivenessDetectorComponent
            key={sessionId}
            sessionId={sessionId}
            region={region}
            onAnalysisComplete={handleAnalysisComplete}
            onError={handleLivenessError}
            onUserCancel={handleUserCancel}
            // FaceLivenessDetector only honors STS via config.credentialProvider
            // (top-level credentialProvider is ignored; Cognito fetchAuthSession is used).
            config={{ credentialProvider }}
          />
        </div>
      )}

      {status.state !== states.LOADING && view === VIEW.LIVENESS_PASSED && (
        <div className="mt-6 space-y-4" data-testid="liveness-passed">
          <p className="text-sm">{t1('liveness_passed_msg')}</p>
          <button
            type="button"
            id="retry_liveness"
            className="flex justify-center w-full font-semibold rounded-md px-5 py-3 text-center border-2 primary-button"
            onClick={handleRetry}
          >
            {t1('retry')}
          </button>
        </div>
      )}
    </>
  );
}
