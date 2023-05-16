/* eslint-disable no-console, camelcase, no-unused-vars */
import { strict as assert } from 'node:assert';
import * as querystring from 'node:querystring';
import { inspect } from 'node:util';

import isEmpty from 'lodash/isEmpty.js';
import { urlencoded } from 'express'; // eslint-disable-line import/no-unresolved

import Account from '../support/account.js';

const body = urlencoded({ extended: false });

const keys = new Set();
const debug = (obj) => querystring.stringify(Object.entries(obj).reduce((acc, [key, value]) => {
  keys.add(key);
  if (isEmpty(value)) return acc;
  acc[key] = inspect(value, { depth: null });
  return acc;
}, {}), '<br/>', ': ', {
  encodeURIComponent(value) { return keys.has(value) ? `<strong>${value}</strong>` : value; },
});

export default (app, provider) => {
  // const { constructor: { errors: { SessionNotFound } } } = provider;

  app.use((req, res, next) => {
    const orig = res.render;
    // you'll probably want to use a full blown render engine capable of layouts
    res.render = (view, locals) => {
      app.render(view, locals, (err, html) => {
        if (err) throw err;
        orig.call(res, '_layout', {
          ...locals,
          body: html,
        });
      });
    };
    next();
  });

  function setNoCache(req, res, next) {
    res.set('cache-control', 'no-store');
    next();
  }

  app.get('/interaction/:uid', setNoCache, async (req, res, next) => {
    try {
      const interactionDetails = await provider.interactionDetails(req, res);
      const {
        uid, prompt, params, session,
      } = interactionDetails;

      const client = await provider.Client.find(params.client_id);
      console.log('/interaction/:uid', interactionDetails);

      switch (prompt.name) {
        case 'login': {
          return res.render('login', {
            client,
            uid,
            details: prompt.details,
            params,
            title: 'Sign-in',
            session: session ? debug(session) : undefined,
            dbg: {
              params: debug(params),
              prompt: debug(prompt),
            },
          });
        }
        default:
          return undefined;
      }
    } catch (err) {
      return next(err);
    }
  });

  app.post('/interaction/:uid/login', setNoCache, body, async (req, res, next) => {
    try {
      if (req.body.password === 'f') {
        const result = {
          // an error field used as error code indicating a failure during the interaction
          error: 'access_denied',
          error_description: 'Username or password is incorrect.',
        };

        await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
      }
      else {
        const interactionDetails = await provider.interactionDetails(req, res);
        const { prompt: { name }, params } = interactionDetails;
        console.log('/interaction/:uid/login', req.body, { interactionDetails });

        assert.equal(name, 'login');
        const account = await Account.findByLogin(req.body.login);
        const { accountId } = account;

        const grant = new provider.Grant({
          accountId,
          clientId: params.client_id,
        });

        grant.addOIDCScope(['openid', 'profile'].join(' '));

        const grantId = await grant.save();
        const result = {
          consent: { grantId },
          login: {
            accountId,
          },
        };
        console.log('result', result);

        await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
      }
    } catch (err) {
      next(err);
    }
  });

  app.use((err, req, res, next) => {
    if (err) {
      // handle interaction expired / session not found error
      console.log(err);
    }
    next(err);
  });
};
