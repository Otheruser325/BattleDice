resolve: {
  fallback: {
    "process": require.resolve("process/browser")
  }
},
plugins: [
  new webpack.ProvidePlugin({
    process: 'process/browser',
  }),
]