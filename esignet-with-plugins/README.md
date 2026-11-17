## eSignet with plugins docker

This directory contains files required to build the eSignet docker with default plugins preloaded. All the plugins 
available under [esignet-plugins](https://github.com/mosip/esignet-plugins) repository is included in the "esignet-with-plugins" docker image.
The local `face-authenticator-plugin` module is also packaged into the image as `jamaica-face-authenticator.jar`.

Based on the configured plugin name during the runtime, corresponding plugin jar will be copied to the eSignet 
classpath from the plugins directory in the docker container.
For example, "plugin_name_env" environment variable is set to "esignet-mock-plugin.jar", then "esignet-mock-plugin.jar" is copied 
to loader_path in the eSignet container. After successful copy eSignet service is started.

"esignet-with-plugins" docker image is created with "esignet" base image. The base image can also be directly used to start the eSignet 
service. There are 2 ways to use "esignet" base image directly.

1. Pass URL to download the plugin zip in the "plugin_url_env" environment variable of the container.
2. Mount external directory with the plugin onto "/home/mosip/plugins" directory in the container.

Either of the above 2 steps should be followed, and finally set "plugin_name_env" environment variable. With this setup, eSignet
service should get started with the configured plugin.

### Jamaica Face Authenticator

`jamaica-face-authenticator.jar` implements `Authenticator` for the FLV factor. It consumes an already-approved attempt
from the Jamaica biometric service and does not depend on the AWS SDK.

`doKycAuth` calls `POST /attempts/{attemptId}/consume` with the eSignet **auth transaction id** (not the raw OIDC
transaction id) and the TRN as `individualId`. oidc-ui Face Liveness must create/complete attempts with that same
auth transaction id. `doKycExchange` returns a minimal Base64URL JSON payload with `sub` only (PLAIN_JSON); eSignet
signs userinfo. A richer claims source for Jamaica is not configured yet.

`MOSIP_ESIGNET_JAMAICA_BIOMETRIC_BASE_URL` and `MOSIP_ESIGNET_JAMAICA_PLUGIN_CREDENTIAL` are required when this
authenticator is selected; missing values fail Spring bean creation at startup.

To load it at runtime:

```bash
plugin_name_env=jamaica-face-authenticator.jar
MOSIP_ESIGNET_INTEGRATION_SCAN_BASE_PACKAGE=io.mosip.esignet.jamaica.integration
MOSIP_ESIGNET_INTEGRATION_AUTHENTICATOR=JamaicaFaceAuthenticator
MOSIP_ESIGNET_INTEGRATION_KEY_BINDER=NoOpKeyBinder
MOSIP_ESIGNET_JAMAICA_BIOMETRIC_BASE_URL=http://biometric-service:8080
MOSIP_ESIGNET_JAMAICA_PLUGIN_CREDENTIAL=<shared-secret>
```

Local override example (keeps the default compose on the mock plugin):

```bash
docker compose -f docker-compose.yml -f docker-compose.face-auth.yml up esignet
```

## License
This project is licensed under the terms of [Mozilla Public License 2.0](../LICENSE).
