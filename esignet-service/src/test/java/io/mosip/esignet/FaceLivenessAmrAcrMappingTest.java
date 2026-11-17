/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package io.mosip.esignet;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.mosip.esignet.core.dto.AuthenticationFactor;
import io.mosip.esignet.core.util.AuthenticationContextClassRefUtil;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Objects;
import java.util.Set;

@ExtendWith(MockitoExtension.class)
public class FaceLivenessAmrAcrMappingTest {

    private static final String FACE_LIVENESS_ACR = "mosip:idp:acr:face-liveness";
    private static final String MAPPING_RESOURCE = "/amr_acr_mapping.json";

    private final AuthenticationContextClassRefUtil authenticationContextClassRefUtil =
            new AuthenticationContextClassRefUtil();
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    public void setup() throws IOException {
        String mappingJson;
        try (InputStream in = Objects.requireNonNull(
                getClass().getResourceAsStream(MAPPING_RESOURCE),
                "Missing classpath resource " + MAPPING_RESOURCE)) {
            mappingJson = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        ReflectionTestUtils.setField(authenticationContextClassRefUtil, "objectMapper", mapper);
        ReflectionTestUtils.setField(authenticationContextClassRefUtil, "mappingJson", mappingJson);
    }

    @Test
    public void getAuthFactors_withFaceLivenessAcr_returnsFlv() {
        List<List<AuthenticationFactor>> authFactors =
                authenticationContextClassRefUtil.getAuthFactors(new String[]{FACE_LIVENESS_ACR});

        Assertions.assertNotNull(authFactors);
        Assertions.assertEquals(1, authFactors.size());

        List<AuthenticationFactor> firstAuthFactor = authFactors.getFirst();
        Assertions.assertNotNull(firstAuthFactor);
        Assertions.assertEquals(1, firstAuthFactor.size());
        Assertions.assertEquals("FLV", firstAuthFactor.getFirst().getType());
    }

    @Test
    public void getSupportedACRValues_containsFaceLiveness() {
        Set<String> acrValues = authenticationContextClassRefUtil.getSupportedACRValues();

        Assertions.assertNotNull(acrValues);
        Assertions.assertTrue(acrValues.contains(FACE_LIVENESS_ACR));
    }
}
