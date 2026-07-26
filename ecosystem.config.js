// PM2 process config for VPS / bare-metal / Plesk hosting.
//
//   npm install -g pm2
//   BUILD_STANDALONE=1 npm run build
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup      # survive reboots
//
// Secrets are NOT listed here on purpose - this file is committed to git. Put
// them in .env.production on the server; the app loads process.env normally, so
// export them in your shell profile or use `pm2 start --env-from-file`.

module.exports = {
  apps: [
    {
      name: "memepump",
      // Standalone build output. If you build WITHOUT BUILD_STANDALONE=1, use
      // script: "npm" and args: "start" instead.
      script: ".next/standalone/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      // Restart if the process balloons past this - protects a small VPS.
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      time: true,
    },
  ],
};
