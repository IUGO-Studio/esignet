#!/bin/sh
set -e

# Substitute Biometric Service host into nginx.conf before the image entrypoint runs.
host="${BIOMETRIC_SERVICE_HOST:-biometric-service}"
sed "s/__BIOMETRIC_SERVICE_HOST__/${host}/g" /tmp/nginx.conf.template > /etc/nginx/nginx.conf

# configure_start.sh always cds into plugins/temp; ensure it exists at runtime.
plugins_temp="/usr/share/nginx/html/plugins/temp"
mkdir -p "${plugins_temp}"
if [ ! -f "${plugins_temp}/sign-in-button-plugin.zip" ]; then
  wget --no-check-certificate --no-cache --no-cookies \
    "${SIGN_IN_WITH_ESIGNET_PLUGIN_URL:-https://raw.githubusercontent.com/mosip/artifactory-ref-impl/master/artifacts/src/mosip-plugins/sign-in-with-esignet/sign-in-with-esignet.zip}" \
    -O "${plugins_temp}/sign-in-button-plugin.zip"
fi

# Overriding entrypoint drops the image CMD; keep nginx running after configure_start.
if [ "$#" -eq 0 ]; then
  set -- sh -c 'echo starting nginx; nginx; sleep infinity'
fi

exec sh /home/mosip/configure_start.sh "$@"
