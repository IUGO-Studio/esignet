/**
 * CRA 5 webpack overrides. Amplify / SBI pull Node builtins that webpack 5
 * no longer polyfills; CI=true treats the unresolved "crypto" warning as error.
 */
module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      webpackConfig.resolve = webpackConfig.resolve || {};
      webpackConfig.resolve.fallback = {
        ...(webpackConfig.resolve.fallback || {}),
        crypto: false,
      };
      return webpackConfig;
    },
  },
};
