const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
  entry: "./src/index.ts",
  output: {
    filename: "app.js",
    path: path.resolve(__dirname, "dist"),
    clean: true,
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
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [
          "style-loader",
          {
            loader: "css-loader",
            options: { url: false },
          },
        ],
      },
      {
        test: /\.(png|svg|jpg|jpeg)$/i,
        type: "asset/resource",
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/index.html",
      inject: "body",
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: "src/appconfig.json", to: "appconfig.json" },
        { from: "src/images/map.png", to: "images/map.png" },
        { from: "src/images/bg.png", to: "images/bg.png" },
        { from: "src/images/coffee.png", to: "images/coffee.png" },
        { from: "src/images/discord.png", to: "images/discord.png" },
        { from: "src/images/brothers-anchor.data.png", to: "images/brothers-anchor.png" },
        { from: "src/images/decreasing-sides.png", to: "images/decreasing-sides.png" },
        { from: "src/images/rotating-arrow.png", to: "images/rotating-arrow.png" },
        { from: "src/images/rising-grey-space.png", to: "images/rising-grey-space.png" },
        { from: "src/images/clockwise-grey-space.png", to: "images/clockwise-grey-space.png" },
      ],
    }),
  ],
  devServer: {
    static: path.resolve(__dirname, "dist"),
    hot: true,
  },
};
