const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
  context: path.resolve(__dirname, "src"),
  entry: "./index.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "main.js",
    clean: true
  },
  devtool: false,
  resolve: {
    extensions: [".ts", ".js"],
    alias: {
      canvas: false,
      sharp: false,
      "electron/common": false,
    },
  },
   module: {
    // The rules section tells webpack what to do with different file types when you import them from js/ts
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "ts-loader",
          options: {
            transpileOnly: true
          }
        },
        exclude: /node_modules[\\/](?!alt1[\\/])/
      },
      { test: /\.css$/, use: ["style-loader", { loader: "css-loader", options: { url: false }, },] },
      { test: /\.scss$/, use: ["style-loader", "css-loader", "sass-loader"] },

      // file types useful for writing alt1 apps, make sure these two loader come after any other json or png loaders, otherwise they will be ignored
      { test: /\.data\.png$/, loader: "alt1/imagedata-loader", type: "javascript/auto" },
      { test: /\.fontmeta\.json$/, loader: "alt1/font-loader", type: "json" }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./index.html",
      inject: "body",
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: "appconfig.json", to: "appconfig.json" },
        { from: "images", to: "images" },
      ]
    })
  ],
  devServer: {
    static: { directory: path.resolve(__dirname, "dist") },
    port: 8080,
    hot: true,
    client: { overlay: true }
  },
  performance: { hints: false }
};
