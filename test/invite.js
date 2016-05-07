'use strict';

// require modules
import test from 'ava';
import invite from '../lib/invite';
import nock from 'nock';
import querystring from 'querystring';
import moment from 'moment';

// require test helpers
import BotHelper from './helpers/bot';
import StorageHelper from './helpers/storage';
import MessageHelper from './helpers/message';

// setup good invitation test
test.beforeEach(t => {
  let guest = 'buritica@gmail.com';

  // initialize helpers
  let storage = new StorageHelper();
  let bot = new BotHelper({ storage });
  let message = new MessageHelper({
    user: 'userID',
    match: [`invite a ${guest}`, `${guest}`],
  });

  // setup user stubbed data
  let createdAt = moment().subtract(100, 'days');
  let hostData = {
    id: message.user,
    createdAt,
  };
  storage.users.get.callsArgWith(1, null, hostData);

  // export context
  t.context = {
    guest,
    bot,
    message,
    createdAt,
  };
});

test.afterEach(nock.cleanAll);

test.cb('it sends new invitation', t => {
  t.plan(2);

  let { bot, guest, message } = t.context;
  nock('https://colombia-dev.slack.com')
    .post('/api/users.admin.invite')
    .reply((uri, body, cb) => {
      let { email, token } = querystring.parse(body);

      t.is(email, guest, `email is ${email}`);
      t.is(token, process.env.SLACK_ADMIN_TOKEN, `token is ${token}`);
      cb(null, [200, { ok: true }]);
    });

  // make invitation request
  invite(bot, message, t.end);
});

test.cb('it replies to new invitation success', t => {
  t.plan(1);

  let { bot, message } = t.context;
  let replyMessage = [
    '¡Invitación esitosa!',
    'Le cuento que ud es responsable por sus invitados y yo tengo buena memoria :wink:.',
  ].join(' ');
  nock('https://colombia-dev.slack.com')
    .post('/api/users.admin.invite')
    .reply(200, { ok: true });

  // make invitation request
  invite(bot, message, () => {
    let calledWith = bot.reply.calledWith(message, replyMessage);
    t.true(calledWith, 'bot replied');
    t.end(null);
  });
});

test.cb('it adds log to hosts storage with guests', t => {
  t.plan(4);

  let { bot, guest, message, createdAt } = t.context;
  let { storage } = bot.botkit;
  nock('https://colombia-dev.slack.com')
    .post('/api/users.admin.invite')
    .reply(200, { ok: true });

  // setup storage
  let hostData = {
    id: message.user,
    guests: [{ guest: 'previous@gmail.com', result: 'ok' }],
    createdAt,
  };
  storage.users.get.callsArgWith(1, null, hostData);

  // make invitation request
  invite(bot, message, function () {
    let getCalledWith = storage.users.get.calledWith(message.user);
    let [previousGuest, newGuest] = storage.users.save.args[0][0].guests;

    t.true(getCalledWith, 'finds host data');
    t.is(newGuest.guest, guest, `logged guest is ${newGuest}`);
    t.is(newGuest.result, 'ok', `logged result is ok`);
    t.is(previousGuest, hostData.guests[0], `logged guest is ${previousGuest}`);
    t.end(null);
  });
});

test.cb('it adds log to existing hosts storage with no guests', t => {
  t.plan(3);

  let { bot, guest, message, createdAt } = t.context;
  let { storage } = bot.botkit;
  nock('https://colombia-dev.slack.com')
    .post('/api/users.admin.invite')
    .reply(200, { ok: true });

  // setup storage
  let hostData = {
    id: message.user,
    createdAt,
  };
  storage.users.get.callsArgWith(1, null, hostData);

  // make invitation request
  invite(bot, message, function () {
    let getCalledWith = storage.users.get.calledWith(message.user);
    let [newGuest] = storage.users.save.args[0][0].guests;

    t.true(getCalledWith, 'finds host data');
    t.is(newGuest.guest, guest, `logged guest is ${newGuest}`);
    t.is(newGuest.result, 'ok', `logged result is ok`);
    t.end(null);
  });
});

test.cb('it replies with error if response.status is not 200', t => {
  t.plan(1);

  let { bot, message } = t.context;
  let reply = 'El servidor respondió de mala gana con estatus 500';
  nock('https://colombia-dev.slack.com')
    .post('/api/users.admin.invite')
    .reply(500, { ok: false });

  // make invitation request
  invite(bot, message, () => {
    t.true(bot.reply.calledWith(message, reply), 'bot replied');
    t.end(null);
  });
});

test.cb('it replies with error message if something along flow errors', t => {
  t.plan(2);

  let { bot, message } = t.context;
  let { storage } = bot.botkit;
  let reply = 'Error - esa invitación no funcionó, échele una miradita al log';

  // force database failure
  storage.users.get.callsArgWith(1, new Error('fake db failure'), {});

  // make invitation request
  invite(bot, message, () => {
    t.is(bot.reply.args[0][0], message, 'called with message');
    t.is(bot.reply.args[0][1], reply, 'called with text');
    t.end(null);
  });
});

test.cb('it replies with error message if user has no data', t => {
  t.plan(2);

  let { bot, message } = t.context;
  let { storage } = bot.botkit;
  let reply = 'Error - hubo un problema encontrando su cuenta';

  // force database failure
  storage.users.get.callsArgWith(1, null, null);

  // make invitation request
  invite(bot, message, () => {
    t.is(bot.reply.args[0][0], message, 'called with message');
    t.is(bot.reply.args[0][1], reply, 'called with text');
    t.end(null);
  });
});

test.cb('it replies and logs error message if user has already been invited', t => {
  t.plan(4);

  let { bot, message, guest, createdAt } = t.context;
  let { storage } = bot.botkit;
  let reply = `Error - a ${guest} ya lo invitaron`;

  // slack reponds with 200 and `ok:false` when things dont work ¯\_(ツ)_/¯
  nock('https://colombia-dev.slack.com')
    .post('/api/users.admin.invite')
    .reply(200, { ok: false, error: 'already_invited' });

  let hostData = {
    id: message.user,
    guests: [{ guest: 'previous@gmail.com', result: 'ok' }],
    createdAt,
  };
  storage.users.get.callsArgWith(1, null, hostData);

  // make invitation request
  invite(bot, message, () => {
    let newGuest = storage.users.save.args[0][0].guests[1];

    t.is(bot.reply.args[0][0], message, 'called with message');
    t.is(bot.reply.args[0][1], reply, 'called with text');
    t.is(newGuest.guest, guest, `logged guest is ${newGuest}`);
    t.is(newGuest.result, 'already_invited', `logged result is already_invited`);
    t.end(null);
  });
});

test.cb('it replies and logs error message if user has already joined team', t=> {
  t.plan(3);

  let { bot, message, guest, createdAt } = t.context;
  let { storage } = bot.botkit;
  let reply = `Error - ${guest} ya tiene cuenta en este Slack`;

  // slack reponds with 200 and `ok:false` when things dont work ¯\_(ツ)_/¯
  nock('https://colombia-dev.slack.com')
    .post('/api/users.admin.invite')
    .reply(200, { ok: false, error: 'already_in_team' });

  let hostData = {
    id: message.user,
    guests: [{ guest: 'previous@gmail.com', result: 'ok' }],
    createdAt,
  };
  storage.users.get.callsArgWith(1, null, hostData);

  // make invitation request
  invite(bot, message, () => {
    let newGuest = storage.users.save.args[0][0].guests[1];

    t.true(bot.reply.calledWith(message, reply), 'bot replied');
    t.is(newGuest.guest, guest, `logged guest is ${newGuest}`);
    t.is(newGuest.result, 'already_in_team', `logged result is already_in_team`);
    t.end(null);
  });
});

test.cb('it restricts accounts older than 45 days from sending invitations', (t) => {
  t.plan(1);

  let { bot, message } = t.context;
  let { storage } = bot.botkit;
  let reply = `Error - debes esperar 45 días para poder invitar a otras personas`;
  let createdAt = moment();

  let hostData = {
    id: message.user,
    createdAt,
  };
  storage.users.get.callsArgWith(1, null, hostData);

  // make invitation request
  invite(bot, message, () => {
    t.is(bot.reply.args[0][1], reply, 'bot replied');
    t.end(null);
  });
});

test.cb('it allows accounts older than 45 days to send invitations', (t) => {
  t.plan(1);

  nock('https://colombia-dev.slack.com')
    .post('/api/users.admin.invite')
    .reply(200, { ok: true });

  let { bot, message } = t.context;
  let { storage } = bot.botkit;
  let reply = [
    '¡Invitación esitosa!',
    'Le cuento que ud es responsable por sus invitados y yo tengo buena memoria :wink:.',
  ].join(' ');

  let hostData = {
    id: message.user,
    createdAt: moment().subtract(100, 'days'),
  };
  storage.users.get.callsArgWith(1, null, hostData);

  // make invitation request
  invite(bot, message, () => {
    t.is(bot.reply.args[0][1], reply, 'bot replied');
    t.end(null);
  });
});

