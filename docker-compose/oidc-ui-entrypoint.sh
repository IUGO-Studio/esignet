#!/bin/sh
set -e

# Substitute Biometric Service host into nginx.conf before the image entrypoint runs.
host="${BIOMETRIC_SERVICE_HOST:-biometric-service}"
sed "s/__BIOMETRIC_SERVICE_HOST__/${host}/g" /tmp/nginx.conf.template > /etc/nginx/nginx.conf

exec sh /home/mosip/configure_start.sh "$@"
