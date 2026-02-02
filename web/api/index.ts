/**
 * Vercel serverless entry for /api. Self-contained Express app so the function
 * does not depend on ../server.js (which may not resolve in Vercel's runtime).
 * Requires rewrite: /api/:path* -> /api in vercel.json.
 */
import express from 'express';
import meHandler from '../dist-handlers/me.js';
import storesHandler from '../dist-handlers/stores.js';
import storesIdHandler from '../dist-handlers/stores/[id].js';
import businessesHandler from '../dist-handlers/businesses.js';
import businessesIdHandler from '../dist-handlers/businesses/[id].js';
import opportunitiesHandler from '../dist-handlers/opportunities.js';
import opportunitiesIdHandler from '../dist-handlers/opportunities/[id].js';
import opportunitiesConvertHandler from '../dist-handlers/opportunities/[id]/convert.js';
import contactsHandler from '../dist-handlers/contacts.js';
import contactsIdHandler from '../dist-handlers/contacts/[id].js';
import invitesHandler from '../dist-handlers/invites.js';
import invitesIdHandler from '../dist-handlers/invites/[id].js';
import calendarEventsHandler from '../dist-handlers/calendar-events.js';
import calendarEventsIdHandler from '../dist-handlers/calendar-events/[id].js';
import getCalendarEventsHandler from '../dist-handlers/get-calendar-events.js';
import dayPlannerHandler from '../dist-handlers/day-planner.js';
import chatCompletionHandler from '../dist-handlers/chat-completion.js';
import createContactFromCallHandler from '../dist-handlers/create-contact-from-call.js';
import sendInviteEmailHandler from '../dist-handlers/send-invite-email.js';
import placesAutocompleteHandler from '../dist-handlers/places-autocomplete.js';
import placesDetailsHandler from '../dist-handlers/places-details.js';
import placesNearbyHandler from '../dist-handlers/places-nearby.js';
import usersIndexHandler from '../dist-handlers/users/index.js';
import usersUidHandler from '../dist-handlers/users/[uid].js';
import usersSyncHandler from '../dist-handlers/users/sync.js';
import discoverySearchHandler from '../dist-handlers/discovery/search.js';
import discoveredPlacesHandler from '../dist-handlers/discovered-places.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

type Handler = (req: express.Request, res: express.Response) => Promise<unknown>;

const route = (handler: Handler) => (req: express.Request, res: express.Response) => handler(req, res);

const withId = (handler: Handler): express.RequestHandler => (req, res) => {
  (req as express.Request & { query: Record<string, string> }).query = { ...req.query, id: req.params.id };
  return handler(req, res);
};

const withUid = (handler: Handler): express.RequestHandler => (req, res) => {
  (req as express.Request & { query: Record<string, string> }).query = { ...req.query, uid: req.params.uid };
  return handler(req, res);
};

app.get('/api/me', route(meHandler));
app.get('/api/stores', route(storesHandler));
app.post('/api/stores', route(storesHandler));
app.all('/api/stores/:id', withId(storesIdHandler));
app.get('/api/businesses', route(businessesHandler));
app.post('/api/businesses', route(businessesHandler));
app.all('/api/businesses/:id', withId(businessesIdHandler));
app.get('/api/opportunities', route(opportunitiesHandler));
app.post('/api/opportunities', route(opportunitiesHandler));
app.all('/api/opportunities/:id', withId(opportunitiesIdHandler));
app.post('/api/opportunities/:id/convert', withId(opportunitiesConvertHandler));
app.get('/api/contacts', route(contactsHandler));
app.post('/api/contacts', route(contactsHandler));
app.all('/api/contacts/:id', withId(contactsIdHandler));
app.get('/api/invites', route(invitesHandler));
app.post('/api/invites', route(invitesHandler));
app.all('/api/invites/:id', withId(invitesIdHandler));
app.get('/api/calendar-events', route(calendarEventsHandler));
app.post('/api/calendar-events', route(calendarEventsHandler));
app.all('/api/calendar-events/:id', withId(calendarEventsIdHandler));
app.get('/api/get-calendar-events', route(getCalendarEventsHandler));
app.get('/api/day-planner', route(dayPlannerHandler));
app.post('/api/chat-completion', route(chatCompletionHandler));
app.post('/api/create-contact-from-call', route(createContactFromCallHandler));
app.post('/api/send-invite-email', route(sendInviteEmailHandler));
app.post('/api/places-autocomplete', route(placesAutocompleteHandler));
app.post('/api/places-details', route(placesDetailsHandler));
app.post('/api/places-nearby', route(placesNearbyHandler));
app.get('/api/users', route(usersIndexHandler));
app.post('/api/users', route(usersIndexHandler));
app.all('/api/users/:uid', withUid(usersUidHandler));
app.post('/api/users/sync', route(usersSyncHandler));
app.post('/api/discovery/search', route(discoverySearchHandler));
app.get('/api/discovered-places', route(discoveredPlacesHandler));

export default app;
