/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package io.mosip.esignet.jamaica.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.mosip.esignet.api.dto.AuthChallenge;
import io.mosip.esignet.api.dto.KycAuthDto;
import io.mosip.esignet.api.dto.KycAuthResult;
import io.mosip.esignet.api.exception.KycAuthException;
import io.mosip.esignet.api.exception.KycExchangeException;
import io.mosip.esignet.api.exception.KycSigningCertificateException;
import io.mosip.esignet.api.exception.SendOtpException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static io.mosip.esignet.api.util.ErrorConstants.AUTH_FAILED;
import static io.mosip.esignet.api.util.ErrorConstants.INVALID_AUTH_FACTOR_TYPE;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JamaicaFaceAuthenticatorTest {

    private static final String CREDENTIAL = "test-plugin-credential";
    private static final String ATTEMPT_ID = "11111111-2222-3333-4444-555555555555";
    private static final String TRANSACTION_ID = "auth-txn-1";
    private static final String TRN = "123456789";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final AtomicInteger statusCode = new AtomicInteger(200);
    private final AtomicReference<String> responseBody = new AtomicReference<>("{\"trn\":\"" + TRN + "\"}");
    private final AtomicReference<String> lastAuthorization = new AtomicReference<>();
    private final AtomicReference<String> lastRequestBody = new AtomicReference<>();
    private final AtomicReference<String> lastPath = new AtomicReference<>();

    private HttpServer server;
    private JamaicaFaceAuthenticator authenticator;

    @BeforeEach
    void setUp() throws IOException {
        statusCode.set(200);
        responseBody.set("{\"trn\":\"" + TRN + "\"}");
        lastAuthorization.set(null);
        lastRequestBody.set(null);
        lastPath.set(null);

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/attempts/", exchange -> {
            lastPath.set(exchange.getRequestURI().getPath());
            lastAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            lastRequestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            writeResponse(exchange, statusCode.get(), responseBody.get());
        });
        server.start();

        String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        BiometricAttemptClient client = new BiometricAttemptClient(
                baseUrl, CREDENTIAL, HttpClient.newHttpClient(), objectMapper);
        authenticator = new JamaicaFaceAuthenticator(client);
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void doKycAuthConsumesApprovedAttemptAndReturnsTrnAsPsut() throws Exception {
        KycAuthResult result = authenticator.doKycAuth("rp-1", "client-1", authDto());

        assertNotNull(result.getKycToken());
        assertFalse(result.getKycToken().isBlank());
        assertEquals(TRN, result.getPartnerSpecificUserToken());
        assertEquals("/attempts/" + ATTEMPT_ID + "/consume", lastPath.get());
        assertEquals("Bearer " + CREDENTIAL, lastAuthorization.get());

        JsonNode body = objectMapper.readTree(lastRequestBody.get());
        assertEquals(TRANSACTION_ID, body.get("transactionId").asText());
        assertEquals(TRN, body.get("trn").asText());
    }

    @Test
    void doKycAuthFailsWhenBiometricReturnsUnauthorized() {
        statusCode.set(401);
        responseBody.set("{\"error\":\"unauthorized\"}");

        KycAuthException ex = assertThrows(
                KycAuthException.class, () -> authenticator.doKycAuth("rp-1", "client-1", authDto()));
        assertEquals(AUTH_FAILED, ex.getErrorCode());
    }

    @Test
    void doKycAuthFailsWhenBiometricReturnsNotFound() {
        statusCode.set(404);
        responseBody.set("{\"error\":\"not_found\"}");

        KycAuthException ex = assertThrows(
                KycAuthException.class, () -> authenticator.doKycAuth("rp-1", "client-1", authDto()));
        assertEquals(AUTH_FAILED, ex.getErrorCode());
    }

    @Test
    void doKycAuthFailsWhenBiometricReturnsConflict() {
        statusCode.set(409);
        responseBody.set("{\"error\":\"already_consumed\"}");

        KycAuthException ex = assertThrows(
                KycAuthException.class, () -> authenticator.doKycAuth("rp-1", "client-1", authDto()));
        assertEquals(AUTH_FAILED, ex.getErrorCode());
    }

    @Test
    void doKycAuthFailsWhenBiometricReturnsInvalidBody() {
        responseBody.set("{\"foo\":\"bar\"}");

        KycAuthException ex = assertThrows(
                KycAuthException.class, () -> authenticator.doKycAuth("rp-1", "client-1", authDto()));
        assertEquals(AUTH_FAILED, ex.getErrorCode());
    }

    @Test
    void doKycAuthFailsWhenFlvChallengeMissing() {
        KycAuthDto dto = new KycAuthDto(TRANSACTION_ID, TRN, List.of());

        KycAuthException ex = assertThrows(
                KycAuthException.class, () -> authenticator.doKycAuth("rp-1", "client-1", dto));
        assertEquals(INVALID_AUTH_FACTOR_TYPE, ex.getErrorCode());
    }

    @Test
    void doKycAuthFailsWhenChallengeIsNotFlv() {
        AuthChallenge otp = new AuthChallenge();
        otp.setAuthFactorType("OTP");
        otp.setChallenge("123456");
        otp.setFormat("alpha-numeric");
        KycAuthDto dto = new KycAuthDto(TRANSACTION_ID, TRN, List.of(otp));

        KycAuthException ex = assertThrows(
                KycAuthException.class, () -> authenticator.doKycAuth("rp-1", "client-1", dto));
        assertEquals(INVALID_AUTH_FACTOR_TYPE, ex.getErrorCode());
    }

    @Test
    void unsupportedSpiMethodsFailExplicitly() {
        assertThrows(KycExchangeException.class, () -> authenticator.doKycExchange("rp", "client", null));
        assertThrows(SendOtpException.class, () -> authenticator.sendOtp("rp", "client", null));
        assertThrows(KycSigningCertificateException.class, authenticator::getAllKycSigningCertificates);
        assertFalse(authenticator.isSupportedOtpChannel("email"));
    }

    @Test
    void biometricClientRejectsBlankConfiguration() {
        IllegalArgumentException blankUrl = assertThrows(
                IllegalArgumentException.class,
                () -> new BiometricAttemptClient(" ", CREDENTIAL, HttpClient.newHttpClient(), objectMapper));
        assertTrue(blankUrl.getMessage().contains("biometricBaseUrl"));

        IllegalArgumentException blankCredential = assertThrows(
                IllegalArgumentException.class,
                () -> new BiometricAttemptClient("http://localhost:8080", " ", HttpClient.newHttpClient(), objectMapper));
        assertTrue(blankCredential.getMessage().contains("pluginCredential"));
    }

    private static KycAuthDto authDto() {
        AuthChallenge flv = new AuthChallenge();
        flv.setAuthFactorType(JamaicaFaceAuthenticator.AUTH_FACTOR_FLV);
        flv.setChallenge(ATTEMPT_ID);
        flv.setFormat("jwt");
        return new KycAuthDto(TRANSACTION_ID, TRN, List.of(flv));
    }

    private static void writeResponse(HttpExchange exchange, int code, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
