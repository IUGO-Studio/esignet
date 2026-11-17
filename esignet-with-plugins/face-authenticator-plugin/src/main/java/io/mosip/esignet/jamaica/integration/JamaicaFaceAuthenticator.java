/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package io.mosip.esignet.jamaica.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.mosip.esignet.api.dto.AuthChallenge;
import io.mosip.esignet.api.dto.KycAuthDto;
import io.mosip.esignet.api.dto.KycAuthResult;
import io.mosip.esignet.api.dto.KycExchangeDto;
import io.mosip.esignet.api.dto.KycExchangeResult;
import io.mosip.esignet.api.dto.KycSigningCertificateData;
import io.mosip.esignet.api.dto.SendOtpDto;
import io.mosip.esignet.api.dto.SendOtpResult;
import io.mosip.esignet.api.exception.KycAuthException;
import io.mosip.esignet.api.exception.KycExchangeException;
import io.mosip.esignet.api.exception.KycSigningCertificateException;
import io.mosip.esignet.api.exception.SendOtpException;
import io.mosip.esignet.api.spi.Authenticator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.net.http.HttpClient;
import java.util.List;
import java.util.UUID;

import static io.mosip.esignet.api.util.ErrorConstants.AUTH_FAILED;
import static io.mosip.esignet.api.util.ErrorConstants.DATA_EXCHANGE_FAILED;
import static io.mosip.esignet.api.util.ErrorConstants.INVALID_AUTH_FACTOR_TYPE;
import static io.mosip.esignet.api.util.ErrorConstants.INVALID_CHALLENGE;
import static io.mosip.esignet.api.util.ErrorConstants.KYC_SIGNING_CERTIFICATE_FAILED;
import static io.mosip.esignet.api.util.ErrorConstants.NOT_IMPLEMENTED;
import static io.mosip.esignet.api.util.ErrorConstants.SEND_OTP_FAILED;

/**
 * eSignet {@link Authenticator} for Jamaica face liveness.
 * Consumes an already-approved biometric attempt; does not call AWS.
 */
@ConditionalOnProperty(
        value = "mosip.esignet.integration.authenticator",
        havingValue = "JamaicaFaceAuthenticator")
@Component
public class JamaicaFaceAuthenticator implements Authenticator {

    private static final Logger log = LoggerFactory.getLogger(JamaicaFaceAuthenticator.class);

    static final String AUTH_FACTOR_FLV = "FLV";

    private final BiometricAttemptClient biometricAttemptClient;

    public JamaicaFaceAuthenticator(
            @Value("${mosip.esignet.jamaica.biometric-base-url}") String biometricBaseUrl,
            @Value("${mosip.esignet.jamaica.plugin-credential}") String pluginCredential,
            ObjectMapper objectMapper) {
        this(new BiometricAttemptClient(
                biometricBaseUrl,
                pluginCredential,
                HttpClient.newBuilder().build(),
                objectMapper));
    }

    JamaicaFaceAuthenticator(BiometricAttemptClient biometricAttemptClient) {
        this.biometricAttemptClient = biometricAttemptClient;
    }

    @Override
    public KycAuthResult doKycAuth(String relyingPartyId, String clientId, KycAuthDto kycAuthDto)
            throws KycAuthException {
        if (kycAuthDto == null
                || kycAuthDto.getTransactionId() == null
                || kycAuthDto.getTransactionId().isBlank()
                || kycAuthDto.getIndividualId() == null
                || kycAuthDto.getIndividualId().isBlank()) {
            throw new KycAuthException(AUTH_FAILED, "Missing transactionId or individualId");
        }

        String attemptId = extractFlvAttemptId(kycAuthDto.getChallengeList());
        String trn = biometricAttemptClient.consume(
                attemptId, kycAuthDto.getTransactionId(), kycAuthDto.getIndividualId());

        String kycToken = UUID.randomUUID().toString();
        log.info("Face liveness KYC auth succeeded for relyingPartyId={}", relyingPartyId);
        return new KycAuthResult(kycToken, trn);
    }

    @Override
    public KycExchangeResult doKycExchange(
            String relyingPartyId, String clientId, KycExchangeDto kycExchangeDto) throws KycExchangeException {
        throw new KycExchangeException(DATA_EXCHANGE_FAILED, "KYC exchange claims source is not configured");
    }

    @Override
    public SendOtpResult sendOtp(String relyingPartyId, String clientId, SendOtpDto sendOtpDto)
            throws SendOtpException {
        throw new SendOtpException(SEND_OTP_FAILED);
    }

    @Override
    public boolean isSupportedOtpChannel(String channel) {
        return false;
    }

    @Override
    public List<KycSigningCertificateData> getAllKycSigningCertificates()
            throws KycSigningCertificateException {
        throw new KycSigningCertificateException(KYC_SIGNING_CERTIFICATE_FAILED, NOT_IMPLEMENTED);
    }

    private static String extractFlvAttemptId(List<AuthChallenge> challengeList) throws KycAuthException {
        if (challengeList == null || challengeList.isEmpty()) {
            throw new KycAuthException(INVALID_AUTH_FACTOR_TYPE, "FLV challenge required");
        }

        AuthChallenge flvChallenge = null;
        for (AuthChallenge challenge : challengeList) {
            if (challenge != null && AUTH_FACTOR_FLV.equalsIgnoreCase(challenge.getAuthFactorType())) {
                flvChallenge = challenge;
                break;
            }
        }
        if (flvChallenge == null) {
            throw new KycAuthException(INVALID_AUTH_FACTOR_TYPE, "FLV challenge required");
        }
        if (flvChallenge.getChallenge() == null || flvChallenge.getChallenge().isBlank()) {
            throw new KycAuthException(INVALID_CHALLENGE, "FLV attemptId is blank");
        }
        return flvChallenge.getChallenge().trim();
    }
}
