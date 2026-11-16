import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react-liveness/styles.css';
import LoadingIndicator from '../common/LoadingIndicator';
import ErrorBanner from '../common/ErrorBanner';
import { challengeFormats, challengeTypes } from '../constants/clientConstants';
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

  const showEsignetError = (errorCode) => {
    setErrorBanner({
      errorCode: `${i18nKeyPrefix2}.${errorCode}`,
      show: true,
    });
  };

  const handleTrnChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, TRN_MAX_LENGTH);
    setTrn(value);
    setErrorBanner(null);
  };

  const isTrnValid = () =>
    TRN_DIGITS_ONLY.test(trn) && trn.length === TRN_MAX_LENGTH;

  const startAttempt = async () => {
    if (!isTrnValid()) {
      showLocalError('invalid_trn');
      return;
    }

    const transactionId = openIDConnectService.getTransactionId();
    setStatus({ state: states.LOADING, msg: 'creating_attempt_msg' });
    setErrorBanner(null);

    try {
      const created = await createAttempt(transactionId, trn);
      setAttemptId(created.attemptId);
      setSessionId(created.sessionId);
      setRegion(created.credentials.region);
      setBrowserCredentials(created.credentials);
      setStatus({ state: states.LOADED, msg: '' });
      setView(VIEW.CAPTURE);
    } catch (error) {
      setStatus({ state: states.LOADED, msg: '' });
      showLocalError(error?.response?.data?.code, 'attempt_create_failed');
    }
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
      showEsignetError(errors[0].errorCode);
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
  };

  const handleAnalysisComplete = async () => {
    const transactionId = openIDConnectService.getTransactionId();
    setStatus({ state: states.LOADING, msg: 'completing_attempt_msg' });
    setErrorBanner(null);

    try {
      const completed = await completeAttempt(attemptId, transactionId);
      setStatus({ state: states.LOADED, msg: '' });

      if (completed.status === ATTEMPT_STATUS.APPROVED) {
        await authenticateWithAttempt(completed.attemptId || attemptId);
        return;
      }

      if (completed.status === ATTEMPT_STATUS.LIVENESS_PASSED) {
        setView(VIEW.LIVENESS_PASSED);
        return;
      }

      clearCaptureState();
      setView(VIEW.TRN);
      showLocalError(completed.failureCode, 'liveness_rejected');
    } catch (error) {
      setStatus({ state: states.LOADED, msg: '' });
      clearCaptureState();
      setView(VIEW.TRN);
      showLocalError(error?.response?.data?.code, 'attempt_complete_failed');
    }
  };

  const handleLivenessError = () => {
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
            sessionId={sessionId}
            region={region}
            onAnalysisComplete={handleAnalysisComplete}
            onError={handleLivenessError}
            onUserCancel={handleUserCancel}
            credentialProvider={credentialProvider}
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
