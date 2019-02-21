// Load environment variables from `.env` file (optional)
require('dotenv').config();

const slackEventsApi = require('@slack/events-api');
const SlackClient = require('@slack/client').WebClient;
const passport = require('passport');
const LocalStorage = require('node-localstorage').LocalStorage;
const SlackStrategy = require('@aoberoi/passport-slack').default.Strategy;
const http = require('http');
const express = require('express');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const request = require('request');
const fileUpload = require('express-fileupload');
const fs = require('fs');


const adapter = new FileSync('db.json');
const db = low(adapter);

db.defaults({ users: [], blockers: {}, count: 0 })
  .write();

// *** Initialize event adapter using signing secret from environment variables ***
const slackEvents = slackEventsApi.createEventAdapter(process.env.SLACK_SIGNING_SECRET, {
  includeBody: true
});

// Initialize a Local Storage object to store authorization info
// NOTE: This is an insecure method and thus for demo purposes only!
const botAuthorizationStorage = new LocalStorage('./storage');
                                       //                                                           botAuthorizationStorage.setItem('T09JELX8X', 'fyT7bhA2P72dCqlJHbBvH9ef');
// Helpers to cache and lookup appropriate client
// NOTE: Not enterprise-ready. if the event was triggered inside a shared channel, this lookup
// could fail but there might be a suitable client from one of the other teams that is within that
// shared channel.
const clients = {};
function getClientByTeamId(teamId) {
  if (!clients[teamId] && botAuthorizationStorage.getItem(teamId)) {
    clients[teamId] = new SlackClient(botAuthorizationStorage.getItem(teamId));
  }
  if (clients[teamId]) {
    return clients[teamId];
  }
  return null;
}

// Initialize Add to Slack (OAuth) helpers
passport.use(new SlackStrategy({
  clientID: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  skipUserProfile: true,
}, (accessToken, scopes, team, extra, profiles, done) => {
  botAuthorizationStorage.setItem(team.id, extra.bot.accessToken);
  done(null, {});
}));

// Initialize an Express application
const app = express();

// Plug the Add to Slack (OAuth) helpers into the express app
app.use(passport.initialize());
app.get('/', (req, res) => {
  res.send('<a href="/auth/slack"><img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>');
});
app.get('/auth/slack', passport.authenticate('slack', {
  scope: ['bot']
}));
app.get('/auth/slack/callback',
  passport.authenticate('slack', { session: false }),
  (req, res) => {
    res.send('<p>Greet and React was successfully installed on your team.</p>');
  },
  (err, req, res, next) => {
    res.status(500).send(`<p>Greet and React failed to install</p> <pre>${err}</pre>`);
  }
);

// *** Plug the event adapter into the express app as middleware ***
app.use('/slack/receive', slackEvents.expressMiddleware());
app.use(fileUpload());
// *** Attach listeners to the event adapter ***

slackEvents.on('message', (message, body) => {
  console.log('MESSAGE');
  console.log('%c GABPAC ------- message ', 'background: #222; color: yellow', message);
  console.log('%c GABPAC ------- body ', 'background: #222; color: yellow', body);
  if (message.channel === 'CGC0VCYK0') { // #hasamti-channel

    // ------------------------ REGISTER PLATE----------------------------------------
    if (!message.subtype && message.text.indexOf('register') >= 0) {
      // Initialize a client
      const slack = getClientByTeamId(body.team_id);

      const numArr = message.text.split(' ');
      if (numArr.length !== 2) {
        slack.chat.postMessage({ channel: message.channel, text: `Hi, <@${message.user}>! your command was mistyped. Try again like this: "register #######", where # is a numeral of your plate` })
          .catch(console.error);
      } else {
        const num = numArr[1];
        const reg = /^[0-9]*$/;
        if (num.match(reg)) {

          const select = db.get('users').find({user: message.user}).value();
          if (select) {
            db.get('users').find({user: message.user}).assign({plate: num}).write();
          } else {
            db.get('users')
              .push({plate: num, user: message.user})
              .write();
          }
          slack.chat.postMessage({ channel: message.channel, text: `Congrats <@${message.user}>! your plate number ${num} has been registered` })
            .catch(console.error);
        } else {
          slack.chat.postMessage({ channel: message.channel, text: `<@${message.user}> please use only numbers to register your plate.` })
            .catch(console.error);
        }
      }
    }
  }
});

slackEvents.on('file_shared', (message, body) => {
  console.log('file');
  const slack = getClientByTeamId(body.team_id);
  slack.files.info({file: body.event.file.id}).then((res) => {
    //console.log('body --------------res------------>', res.file);
    const imageUrl = res.file.url_private;
    const type = res.file.pretty_type;

    const options = {
      url: imageUrl,
      headers: {
        'User-Agent': 'request',
        'Authorization': 'Bearer xoxp-9626711303-423400364050-555666299511-be07d5850259b3942e8954f372b75228'
      }
    };

    request(options).pipe(fs.createWriteStream('test.png').on('close', () => {
      console.log('DOWNLOADED');

      let secret_Key = 'sk_2755695f7e4deb13caabc664';
      let api_url = 'https://api.openalpr.com/v2/recognize?recognize_vehicle=1&country=eu&secret_key=' + secret_Key;

      const data = {
        image: {
          value:  fs.createReadStream(__dirname + '/test.png'),
          options: {
            filename: 'test.png',
            contentType: 'image/png'
          }
        }
      };
      request.post({url: api_url, formData: data}, (err, res, body) => {


        const data = JSON.parse(body);
        console.log('found plate', data.results[0].plate);

        const result = data.results[0].plate;
        slack.chat.postMessage({ channel: message.channel_id, text: `Hi, <@${message.user_id}> I see you've blocked the car with the plate ${result}.` })
         .catch(console.error);

        db.get('blockers')
          .push({user: message.user_id, blocking: result})
          .write();

        const blockedUser = db.get('users').find({plate: result}).value().user;
      })

    }));
  });
});

/*slackEvents.on('file_created', (message, body) => {

});*/
/*

// *** Responding to reactions with the same emoji ***
slackEvents.on('reaction_added', (event, body) => {
  // Initialize a client
  const slack = getClientByTeamId(body.team_id);
  // Handle initialization failure
  if (!slack) {
    return console.error('No authorization found for this team. Did you install the app through the url provided by ngrok?');
  }
  // Respond to the reaction back with the same emoji
  slack.chat.postMessage({ channel: event.item.channel, text: `:${event.reaction}:` })
    .catch(console.error);
});
*/

// *** Handle errors ***
slackEvents.on('error', (error) => {
  if (error.code === slackEventsApi.errorCodes.TOKEN_VERIFICATION_FAILURE) {
    // This error type also has a `body` propery containing the request body which failed verification.
    console.error(`An unverified request was sent to the Slack events Request URL. Request body: \
${JSON.stringify(error.body)}`);
  } else {
    console.error(`An error occurred while handling a Slack event: ${error.message}`);
  }
});

// Start the express application
const port = process.env.PORT || 3333;
http.createServer(app).listen(port, () => {
  console.log(`server listening on port ${port}`);
});