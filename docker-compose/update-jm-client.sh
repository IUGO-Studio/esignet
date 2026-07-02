#!/usr/bin/env bash
# Updates the Jamaica Inji Web OAuth client in eSignet:
# - OTP-only authentication (no password, Inji wallet, biometrics, or PIN)
# - Disables signup banner and forgot-password link
# - Sets JAMCTA purpose title/subtitle
#
# Usage:
#   ESIGNET_URL=https://esignet.inji-jm.iugolabs.com ./update-jm-client.sh
#
# Defaults to localhost:8088 for local docker-compose.

set -euo pipefail

ESIGNET_URL="${ESIGNET_URL:-http://localhost:8088}"
CLIENT_ID="${CLIENT_ID:-IIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0B5NR}"
REDIRECT_URI="${REDIRECT_URI:-https://web.inji-jm.iugolabs.com/redirect}"
LOGO_URI="${LOGO_URI:-https://certify.inji-jm.iugolabs.com/assets/logo_issuer.png}"

REQUEST_TIME="$(python3 -c 'import datetime; print(datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')"
export REQUEST_TIME LOGO_URI REDIRECT_URI

BODY="$(python3 -c "
import json, os
print(json.dumps({
  'requestTime': os.environ['REQUEST_TIME'],
  'request': {
    'clientName': 'Inji Web Jamaica',
    'logoUri': os.environ['LOGO_URI'],
    'redirectUris': [
      os.environ['REDIRECT_URI'],
      'http://localhost:3004/redirect',
      'http://localhost:5000/**',
      'http://localhost:3000/registration/*',
      'io.mosip.residentapp://oauth',
    ],
    'userClaims': ['name', 'email', 'gender', 'phone_number', 'birthdate', 'picture', 'address'],
    'authContextRefs': ['mosip:idp:acr:generated-code'],
    'status': 'ACTIVE',
    'grantTypes': ['authorization_code'],
    'clientAuthMethods': ['private_key_jwt'],
    'additionalConfig': {
      'userinfo_response_type': 'JWS',
      'purpose': {
        'type': 'verify',
        'title': {
          '@none': 'Verify using JAMCTA Digital ID',
          'eng': 'Verify using JAMCTA Digital ID',
        },
        'subTitle': {
          '@none': '{{clientName}} is requesting authentication for verification',
          'eng': '{{clientName}} is requesting authentication for verification',
        },
      },
      'signup_banner_required': False,
      'forgot_pwd_link_required': False,
      'consent_expire_in_mins': 20,
    },
  },
}))
")"

echo "Updating client ${CLIENT_ID} at ${ESIGNET_URL} ..."
RESPONSE="$(curl -s -X PUT "${ESIGNET_URL}/v1/esignet/client-mgmt/client/${CLIENT_ID}" \
  -H "Content-Type: application/json" \
  -d "${BODY}")"

echo "${RESPONSE}" | python3 -m json.tool

if echo "${RESPONSE}" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if not d.get('errors') else 1)"; then
  echo "OK: client updated (OTP-only, signup banner disabled)."
else
  echo "ERROR: client update failed." >&2
  exit 1
fi
