module.exports = {
    apps : [
        {
            name: 'library',
            script: './node-server.js library-config.json',
            instances: 1,
            cron_restart: '0 0 * * *', // once a day
        },
        {
            name: 'cloud',
            script: './node-server.js cloud-config.json',
            instances: 1,
        },
    ]
  }