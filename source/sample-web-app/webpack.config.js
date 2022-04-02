// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/* eslint-env node */
const webpack = require('webpack');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { WebpackManifestPlugin } = require('webpack-manifest-plugin');
const path = require('path');
// CSS optimizers for production
const autoprefixer = require("autoprefixer");
const TerserJSPlugin = require('terser-webpack-plugin');
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin');

// disambiguates webpack.config.js between development and production builds
// export a function instead of configuration object to determine 'development'
// vs 'production' modes for plugins
// it's possible to look at the command line arguments as well by using
//    module.exports = (env, argv) => { ... }
// https://webpack.js.org/guides/environment-variables/
module.exports = env => {

  console.log(JSON.stringify(env));

  const DEV_MODE = env.NODE_ENV !== 'production';
  console.log('NODE_ENV ? ', env.NODE_ENV);
  console.log('DEV_MODE ? ', DEV_MODE);

  const BUILD_PATH = path.resolve(__dirname, 'dist');
  const APP_PATH = path.resolve(__dirname, 'src');

  console.log('BUILD_PATH ? ', BUILD_PATH);
  console.log('APP_PATH ? ', APP_PATH);

  const postcssOpts = {
		postcssOptions: {
			plugins: [
				autoprefixer
			]
		}
	};

  return {
    // refer to https://webpack.js.org/configuration/mode/
    mode: DEV_MODE ? 'development' : 'production',

    // refer to https://webpack.js.org/configuration/entry-context/
    entry: {
      // approach #1
      // index: path.join(APP_PATH, 'index.jsx'),
      // app: path.join(APP_PATH, 'components/App.jsx'),
      // header: path.join(APP_PATH, 'components/Header/Header.jsx'),
      // main: path.join(APP_PATH, 'components/Main/Main.jsx'),

      // approach #2
      app: path.join(APP_PATH, 'index.jsx'),
    },

    // refer to https://webpack.js.org/configuration/output/
    output: {
      path: BUILD_PATH,
      filename: '[name].bundle.js',
      publicPath: '/'
    },

    // refer to https://webpack.js.org/configuration/resolve/
    resolve: {
      extensions: [
        '.js', '.jsx'
      ],
      // https://github.com/angular/angular-cli/issues/20819
      // graphql/amplify requires polly fills for node modules in webpack 5
      fallback: {
        'stream': require.resolve('stream-browserify'),
        'crypto': require.resolve('crypto-browserify')
      }
    },

    // refer to https://webpack.js.org/configuration/stats/#statschildren
    stats: {
      children: true,
      errorDetails: true
    },

    // refer to https://webpack.js.org/configuration/optimization/
    optimization: {
      splitChunks: {
        chunks: 'all'
      },
      // splitChunks: {
      //   cacheGroups: {
      //     styles: {
      //       name: 'ultra-special-styles',
      //       test: /\.css$/,
      //       chunks: 'all',
      //       enforce: true
      //     }
      //   }
      // },
      // CSS optimizers for production
      minimizer: DEV_MODE ? [] : [new TerserJSPlugin({}), new OptimizeCSSAssetsPlugin({})],
      minimize: ! DEV_MODE,
    },

    // refer to https://webpack.js.org/configuration/module/
    module: {
      rules: [
        {
          test: /(\.js$|\.jsx$)/,
          exclude: /node_modules/,
          // include : APP_PATH,
          use: {
            loader: 'babel-loader',
          }
        },
        // graphql mjs work-around
        // https://github.com/graphql/graphql-js/issues/2721#issuecomment-723008284
        {
          test: /\.m?js/,
          resolve: {
              fullySpecified: false
          }
        },
        {
          test: /\.html$/,
          // include : APP_PATH,
          use: [
            {
              // use raw-loader to process HTML file because there is no easy
              // way to exclude vendor minified css from getting parsed by html-loader.
              // vendor minified css have embedded data:/ tags that cause MiniCssExtractPlugin
              // to fail
              loader: 'raw-loader'
              // loader: "html-loader",
              // options: {
              //   minimize: true
              // }
            }
          ]
        },
        // css-loader bundles all the css files into one file
        {
          test: /\.css$/,
          // include : APP_PATH,
          use: [
            {
              loader: MiniCssExtractPlugin.loader,
              // options: {
              //   // only enable hot in development
              //   // hmr: DEV_MODE,
              //   // if hmr does not work, this is a forceful method.
              //   // reloadAll: DEV_MODE
              // },
            },
            {
              loader: 'css-loader',
              // options: {
              //   sourceMap: DEV_MODE,
              //   modules: false
              // },
            },
            {
							loader:  "postcss-loader",
							options: postcssOpts
						}
          ]
        },
        {
          test: /\.scss$/,
          // include : APP_PATH,
          use: [
            {
              loader: MiniCssExtractPlugin.loader,
              // options: {
              //   // only enable hot in development
              //   // hmr: DEV_MODE,
              //   // if hmr does not work, this is a forceful method.
              //   // reloadAll: DEV_MODE
              // },
            },
            {
              loader: 'css-loader',
              options: {
              //   sourceMap: DEV_MODE,
              //   modules: false
                // https://github.com/webpack-contrib/css-loader#exportonlylocals
                exportOnlyLocals: true,
              },
            },
            {
							loader:  "postcss-loader",
							options: postcssOpts
						},
            {
              loader: 'sass-loader'
            }
          ]
        },
        /*
         * old webpack v4
         */
        /*
        // use file-loader for images
        // refer to https://v4.webpack.js.org/loaders/file-loader/
        {
          test: /\.(png|jpe?g|gif)$/i,
          use: [
            {
              loader: 'file-loader',
              options: {
                outputPath: 'image',
              },
            },
          ],
          type: 'javascript/auto'
        },
        // use url-loader for fonts and smaller files
        {
          test: /\.(ico|svg|eot|otf|ttf|woff|woff2)$/i,
          exclude: /node_modules/,
          use: [
            {
              loader: 'url-loader',
              options: {
                limit: 8192
              }
            }
          ],
          type: 'javascript/auto'
        }
        */
        /*
         * webpack v5 - Asset Modules
         * refer to https://webpack.js.org/guides/asset-modules/
         */
        // handle resource assets
        {
          test: /\.(png|svg|jpg|jpeg|gif)$/i,
          type: 'asset/resource',
        },
        // handle inline assets
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/i,
          type: 'asset/resource',
        },
      ]
    },

    // refer to https://webpack.js.org/configuration/devtool/#devtool
    // another option is to use 'nosources-source-map' in 'production' mode
    devtool: DEV_MODE ? 'eval-source-map' : 'hidden-source-map',

    // refer to https://webpack.js.org/configuration/dev-server/#devserver
    devServer: {
      devMiddleware: {
        writeToDisk: true
      },
      static: {
        directory: APP_PATH,
        publicPath: '/', // The bundled files will be available in the browser under this path.
      },
      historyApiFallback: true,
    },

    // refer to https://webpack.js.org/configuration/plugins/
    plugins: [

      // https://webpack.js.org/guides/development/#using-watch-mode
      // clean the build directory before each build.
      new CleanWebpackPlugin(),

      // https://webpack.js.org/plugins/html-webpack-plugin/#root
      // simplifies creation of HTML files to serve your webpack bundles
      new HtmlWebpackPlugin({
        inject: true,
        template: path.join(APP_PATH, 'index.html')
      }),

      // https://webpack.js.org/plugins/mini-css-extract-plugin/#root
      new MiniCssExtractPlugin({
        filename: 'style/[name].css',
        chunkFilename: 'style/[id].css'
      }),

      // https://webpack.js.org/plugins/copy-webpack-plugin/#getting-started
      // copies individual files or entire directories, which already exist, to the build directory.
      new CopyPlugin({
        patterns: [
          { from: 'src/style', to: 'style' },
          { from: 'src/image', to: 'image' },
          { from: 'node_modules/semantic-ui-css/themes', to: 'style/semantic-ui/themes' },
          { from: 'node_modules/semantic-ui-css/semantic.min.css', to: 'style/semantic-ui/semantic.min.css' }
        ],
      }),

      // https://github.com/danethurber/webpack-manifest-plugin
      // https://webpack.js.org/guides/output-management/
      // generate an asset manifest.
      new WebpackManifestPlugin(),

      // https://webpack.js.org/plugins/define-plugin/#root
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(env.NODE_ENV),
        '__AWS_REGION__': env.AWS_REGION ? JSON.stringify(env.AWS_REGION) : JSON.stringify("us-east-1"),
        '__COGNITO_IDENTITY_POOL_ID__': env.IDENTITY_POOL_ID ? JSON.stringify(env.IDENTITY_POOL_ID) : JSON.stringify(""),
        '__COGNITO_USER_POOL_ID__': env.USER_POOL_ID ? JSON.stringify(env.USER_POOL_ID) : JSON.stringify(""),
        '__COGNITO_CLIENT_ID__': env.CLIENT_ID ? JSON.stringify(env.CLIENT_ID) : JSON.stringify(""),
        '__APPSYNC_API__': env.APPSYNC_API ? JSON.stringify(env.APPSYNC_API) : JSON.stringify(""),
        '__API_GATEWAY_API_NAME__': env.API_GATEWAY_API_NAME ? JSON.stringify(env.API_GATEWAY_API_NAME) : JSON.stringify(""),
        '__API_GATEWAY_API_ENDPOINT__': env.API_GATEWAY_API_ENDPOINT ? JSON.stringify(env.API_GATEWAY_API_ENDPOINT) : JSON.stringify(""),
        '__MOCK_ENABLED__': env.MOCK ? JSON.stringify(env.MOCK) : JSON.stringify(false)
      })
    ]
  };
};
