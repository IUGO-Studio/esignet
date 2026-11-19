/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package io.mosip.esignet.jamaica.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.net.http.HttpClient;
import java.util.Base64;
import java.util.List;

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
 * KYC exchange returns a minimal Base64URL JSON payload ({@code sub} only);
 * eSignet signs PLAIN_JSON userinfo itself.
 */
@ConditionalOnProperty(
        value = "mosip.esignet.integration.authenticator",
        havingValue = "JamaicaFaceAuthenticator")
@Component
public class JamaicaFaceAuthenticator implements Authenticator {

    private static final Logger log = LoggerFactory.getLogger(JamaicaFaceAuthenticator.class);

    static final String AUTH_FACTOR_FLV = "FLV";

    private final BiometricAttemptClient biometricAttemptClient;
    private final ObjectMapper objectMapper;

    // Required: multiple constructors exist for tests; without @Autowired Spring looks for a no-arg ctor.
    @Autowired
    public JamaicaFaceAuthenticator(
            @Value("${mosip.esignet.jamaica.biometric-base-url}") String biometricBaseUrl,
            @Value("${mosip.esignet.jamaica.plugin-credential}") String pluginCredential,
            ObjectMapper objectMapper) {
        this(new BiometricAttemptClient(
                biometricBaseUrl,
                pluginCredential,
                HttpClient.newBuilder().build(),
                objectMapper),
                objectMapper);
    }

    JamaicaFaceAuthenticator(BiometricAttemptClient biometricAttemptClient, ObjectMapper objectMapper) {
        this.biometricAttemptClient = biometricAttemptClient;
        this.objectMapper = objectMapper;
    }

    JamaicaFaceAuthenticator(BiometricAttemptClient biometricAttemptClient) {
        this(biometricAttemptClient, new ObjectMapper());
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

        log.info("Face liveness KYC auth succeeded for relyingPartyId={}", relyingPartyId);
        return new KycAuthResult(trn, trn);
    }

    @Override
    public KycExchangeResult doKycExchange(
            String relyingPartyId, String clientId, KycExchangeDto kycExchangeDto) throws KycExchangeException {
        if (kycExchangeDto == null
                || kycExchangeDto.getIndividualId() == null
                || kycExchangeDto.getIndividualId().isBlank()
                || kycExchangeDto.getKycToken() == null
                || kycExchangeDto.getKycToken().isBlank()) {
            throw new KycExchangeException(DATA_EXCHANGE_FAILED, "Missing individualId or kycToken");
        }

        try {
            ObjectNode claims = objectMapper.createObjectNode();
            claims.put("sub", kycExchangeDto.getIndividualId());
            String encoded = Base64.getUrlEncoder()
                    .withoutPadding()
                    .encodeToString(objectMapper.writeValueAsBytes(claims));
            return new KycExchangeResult(encoded);
        } catch (Exception e) {
            throw new KycExchangeException(DATA_EXCHANGE_FAILED, "Failed to build KYC exchange payload");
        }
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
