/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package io.mosip.esignet.jamaica.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.mosip.esignet.api.exception.KycAuthException;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Objects;

import static io.mosip.esignet.api.util.ErrorConstants.AUTH_FAILED;

/**
 * HTTP client for the biometric service consume endpoint.
 * Uses the JDK {@link HttpClient}; does not depend on the AWS SDK.
 */
public class BiometricAttemptClient {

    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(15);

    private final String biometricBaseUrl;
    private final String pluginCredential;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public BiometricAttemptClient(
            String biometricBaseUrl,
            String pluginCredential,
            HttpClient httpClient,
            ObjectMapper objectMapper) {
        this.biometricBaseUrl = trimTrailingSlash(Objects.requireNonNull(biometricBaseUrl, "biometricBaseUrl"));
        this.pluginCredential = Objects.requireNonNull(pluginCredential, "pluginCredential");
        this.httpClient = Objects.requireNonNull(httpClient, "httpClient");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        if (this.biometricBaseUrl.isBlank()) {
            throw new IllegalArgumentException("biometricBaseUrl must not be blank");
        }
        if (this.pluginCredential.isBlank()) {
            throw new IllegalArgumentException("pluginCredential must not be blank");
        }
    }

    /**
     * Consumes an approved attempt and returns the stored TRN.
     *
     * @throws KycAuthException when the biometric service rejects the consume or the response is invalid
     */
    public String consume(String attemptId, String transactionId, String trn) throws KycAuthException {
        Objects.requireNonNull(attemptId, "attemptId");
        Objects.requireNonNull(transactionId, "transactionId");
        Objects.requireNonNull(trn, "trn");

        ObjectNode body = objectMapper.createObjectNode();
        body.put("transactionId", transactionId);
        body.put("trn", trn);

        HttpRequest request;
        try {
            request = HttpRequest.newBuilder()
                    .uri(URI.create(biometricBaseUrl + "/attempts/" + attemptId + "/consume"))
                    .timeout(REQUEST_TIMEOUT)
                    .header("Authorization", "Bearer " + pluginCredential)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .build();
        } catch (IOException e) {
            throw new KycAuthException(AUTH_FAILED, "Failed to serialize consume request");
        }

        HttpResponse<String> response;
        try {
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new KycAuthException(AUTH_FAILED, "Biometric consume call failed");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new KycAuthException(AUTH_FAILED, "Biometric consume call interrupted");
        }

        if (response.statusCode() != 200) {
            throw new KycAuthException(AUTH_FAILED, "Biometric consume rejected with HTTP " + response.statusCode());
        }

        try {
            JsonNode root = objectMapper.readTree(response.body());
            JsonNode trnNode = root.get("trn");
            if (trnNode == null || !trnNode.isTextual() || trnNode.asText().isBlank()) {
                throw new KycAuthException(AUTH_FAILED, "Biometric consume response missing trn");
            }
            return trnNode.asText();
        } catch (KycAuthException e) {
            throw e;
        } catch (IOException e) {
            throw new KycAuthException(AUTH_FAILED, "Biometric consume response was not valid JSON");
        }
    }

    private static String trimTrailingSlash(String url) {
        if (url.endsWith("/")) {
            return url.substring(0, url.length() - 1);
        }
        return url;
    }
}
