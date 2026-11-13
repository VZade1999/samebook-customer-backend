import {
  canSeeLead,
  fillBlanks,
  flattenPayload,
  followUpState,
  formatIndiaMartTime,
  furthestRank,
  indiaMartPushItems,
  indiaMartWindow,
  interpretIndiaMart,
  isHoneypotHit,
  leadCapabilities,
  localDayBounds,
  mapImportRow,
  mapIndiaMart,
  mapWebhook,
  median,
  normalizeEmail,
  normalizeGstin,
  normalizePhone,
  parseIstDateTime,
  parseLeadKey,
  parseSettings,
  phoneMatchKey,
  pickAssignee,
  reachedPerson,
  shouldAutoClaim,
  sourceFromText,
  stageAfterContact,
  stageAfterQuotation,
} from './crm.rules';

describe('CRM rules', () => {
  describe('normalizePhone', () => {
    it('reduces every Indian mobile form to 10 digits', () => {
      for (const p of ['9876543210', '+91-9876543210', '+91 98765 43210', '919876543210', '09876543210', '0091 98765 43210']) {
        expect(normalizePhone(p)).toBe('9876543210');
      }
    });
    it('keeps international numbers with +', () => {
      expect(normalizePhone('+1 (415) 555-0123')).toBe('+14155550123');
      expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    });
    it('keeps landlines as digits and rejects junk', () => {
      expect(normalizePhone('022 2345 6789')).toBe('02223456789');
      expect(normalizePhone('12')).toBeNull();
      expect(normalizePhone('')).toBeNull();
      expect(normalizePhone(null)).toBeNull();
      expect(normalizePhone({})).toBeNull();
    });
    it('match key is the last 10 digits', () => {
      expect(phoneMatchKey('+919876543210')).toBe('9876543210');
      expect(phoneMatchKey('98765')).toBeNull();
    });
  });

  it('normalises email and GSTIN', () => {
    expect(normalizeEmail('  Rahul.Sharma@Example.COM ')).toBe('rahul.sharma@example.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeGstin('27aaacr5055k1z5')).toBe('27AAACR5055K1Z5');
    expect(normalizeGstin('27AAACR5055K1Z')).toBeNull();
  });

  it('parses lead keys', () => {
    expect(parseLeadKey('LD-12')).toBe(12);
    expect(parseLeadKey('ld 7')).toBe(7);
    expect(parseLeadKey('42')).toBe(42);
    expect(parseLeadKey('Rahul')).toBeNull();
  });

  describe('IndiaMART', () => {
    it('formats pull times in IST without a separator', () => {
      // 03:30 UTC = 09:00 IST
      expect(formatIndiaMartTime(new Date('2021-12-07T03:30:00Z'))).toBe('07-Dec-202109:00:00');
      // crossing midnight in IST
      expect(formatIndiaMartTime(new Date('2024-01-31T19:00:05Z'))).toBe('01-Feb-202400:30:05');
    });

    it('reads QUERY_TIME as IST', () => {
      expect(parseIstDateTime('2024-04-10 11:17:14')?.toISOString()).toBe('2024-04-10T05:47:14.000Z');
      expect(parseIstDateTime('yesterday')).toBeNull();
    });

    const sample = {
      UNIQUE_QUERY_ID: '2904545123',
      QUERY_TYPE: 'W',
      QUERY_TIME: '2024-04-10 11:17:14',
      SENDER_NAME: 'Rahul Sharma',
      SENDER_MOBILE: '+91-9876543210',
      SENDER_EMAIL: 'Rahul@Example.com',
      SUBJECT: 'Requirement for MS Pipes',
      SENDER_COMPANY: 'Sharma Traders',
      SENDER_ADDRESS: 'Plot 4, MIDC, Pune, Maharashtra, 411019',
      SENDER_CITY: 'Pune',
      SENDER_STATE: 'Maharashtra',
      SENDER_PINCODE: '411019',
      SENDER_COUNTRY_ISO: 'IN',
      SENDER_MOBILE_ALT: '+91-9876543210',
      SENDER_PHONE: '',
      SENDER_PHONE_ALT: '020-27123456',
      SENDER_EMAIL_ALT: '',
      QUERY_PRODUCT_NAME: 'MS Pipes',
      QUERY_MESSAGE: 'I want 500 kg MS pipes.\\nPlease send the best price.',
      QUERY_MCAT_NAME: 'Mild Steel Pipes',
      CALL_DURATION: '',
      RECEIVER_MOBILE: '',
    };

    it('maps an enquiry to a lead', () => {
      const l = mapIndiaMart(sample)!;
      expect(l.source).toBe('INDIAMART');
      expect(l.source_ref).toBe('2904545123');
      expect(l.source_detail).toBe('Direct enquiry');
      expect(l.name).toBe('Rahul Sharma');
      expect(l.phone).toBe('9876543210');
      expect(l.alt_phone).toBe('02027123456');
      expect(l.email).toBe('rahul@example.com');
      expect(l.company_name).toBe('Sharma Traders');
      expect(l.city).toBe('Pune');
      expect(l.pincode).toBe('411019');
      expect(l.requirement).toBe('MS Pipes');
      expect(l.message).toContain('Requirement for MS Pipes');
      expect(l.message).toContain('I want 500 kg MS pipes.\nPlease send the best price.');
      expect(l.received_at?.toISOString()).toBe('2024-04-10T05:47:14.000Z');
    });

    it('names anonymous buyers and notes call duration', () => {
      const l = mapIndiaMart({ ...sample, SENDER_NAME: '', QUERY_TYPE: 'P', CALL_DURATION: '45' })!;
      expect(l.name).toBe('IndiaMART Buyer');
      expect(l.source_detail).toBe('Phone call');
      expect(l.message).toContain('Call duration: 45 sec');
      expect(mapIndiaMart({ SENDER_NAME: 'x' })).toBeNull();
    });

    it('finds the lead in push bodies of any shape', () => {
      expect(indiaMartPushItems({ CODE: 200, STATUS: 'SUCCESS', RESPONSE: sample })).toHaveLength(1);
      expect(indiaMartPushItems({ method: 'POST', body: { CODE: 200, RESPONSE: sample } })).toHaveLength(1);
      expect(indiaMartPushItems({ RESPONSE: [sample, { ...sample, UNIQUE_QUERY_ID: '2' }] })).toHaveLength(2);
      expect(indiaMartPushItems({ name: 'Rahul', phone: '98765' })).toHaveLength(0);
    });

    it('interprets pull responses', () => {
      expect(interpretIndiaMart({ CODE: 200, STATUS: 'SUCCESS', RESPONSE: [sample] })).toEqual({ kind: 'OK', items: [sample] });
      expect(interpretIndiaMart({ CODE: 204, STATUS: 'FAILURE', RESPONSE: [] }).kind).toBe('NO_DATA');
      expect(interpretIndiaMart({ CODE: '401', STATUS: 'FAILURE', MESSAGE: 'Key expired' })).toEqual({ kind: 'AUTH', message: 'Key expired' });
      expect(interpretIndiaMart({ CODE: 429, STATUS: 'FAILURE' }).kind).toBe('RATE_LIMIT');
      expect(interpretIndiaMart({ CODE: 500, MESSAGE: 'Some Error Occured' })).toEqual({ kind: 'ERROR', message: 'Some Error Occured' });
      expect(interpretIndiaMart('<html>').kind).toBe('ERROR');
    });

    it('pulls a week first, then overlapping windows, never more than 7 days', () => {
      const now = new Date('2026-11-13T10:00:00Z');
      const first = indiaMartWindow(null, now);
      expect((now.getTime() - first.start.getTime()) / 86_400_000).toBeLessThan(7);
      expect((now.getTime() - first.start.getTime()) / 86_400_000).toBeGreaterThan(6.9);
      const next = indiaMartWindow(new Date('2026-11-13T09:50:00Z'), now);
      expect(next.start.toISOString()).toBe('2026-11-13T09:45:00.000Z');
      expect(next.gap).toBe(false);
      const stale = indiaMartWindow(new Date('2026-10-01T00:00:00Z'), now);
      expect(stale.gap).toBe(true);
      expect(now.getTime() - stale.start.getTime()).toBeLessThan(7 * 86_400_000);
    });
  });

  describe('webhooks', () => {
    it('maps Contact Form 7 style fields and keeps unknown ones in the message', () => {
      const l = mapWebhook(
        {
          'your-name': 'Priya Nair',
          'your-email': 'priya@nair.in',
          'your-phone': '098450 12345',
          'your-message': 'Need 20 office chairs',
          'Delivery city': 'Kochi',
          _wpcf7: '12',
          'g-recaptcha-response': 'abc',
          utm_source: 'google',
        },
        'WEBSITE',
      );
      expect(l.name).toBe('Priya Nair');
      expect(l.email).toBe('priya@nair.in');
      expect(l.phone).toBe('9845012345');
      expect(l.message).toContain('Need 20 office chairs');
      expect(l.message).toContain('Delivery city: Kochi');
      expect(l.message).not.toContain('recaptcha');
      expect(l.message).not.toContain('wpcf7');
      expect(l.source).toBe('WEBSITE');
      expect(l.source_detail).toBe('google');
    });

    it('handles Elementor-style nested fields and first + last name', () => {
      const l = mapWebhook(
        { fields: { fname: { title: 'First Name', value: 'Amit' }, lname: { title: 'Last Name', value: 'Verma' }, ph: { title: 'Mobile', value: '+91 99999 88888' } } },
        'WEBSITE',
      );
      expect(l.name).toBe('Amit Verma');
      expect(l.phone).toBe('9999988888');
    });

    it('handles Google Ads lead forms', () => {
      const l = mapWebhook(
        {
          lead_id: 'TeSter-123',
          user_column_data: [
            { column_id: 'FULL_NAME', string_value: 'Neha Gupta' },
            { column_id: 'PHONE_NUMBER', string_value: '+919811122233' },
            { column_id: 'CITY', string_value: 'Delhi' },
            { column_name: 'Quantity needed', string_value: '50' },
          ],
          google_key: 'secret',
        },
        'WEBSITE',
      );
      expect(l.name).toBe('Neha Gupta');
      expect(l.phone).toBe('9811122233');
      expect(l.city).toBe('Delhi');
      expect(l.source).toBe('GOOGLE');
      expect(l.source_ref).toBe('TeSter-123');
      expect(l.message).toContain('Quantity needed: 50');
    });

    it('uses a known "source" field as the lead source', () => {
      expect(mapWebhook({ name: 'A', phone: '9876543210', source: 'Facebook' }, 'WEBSITE').source).toBe('FACEBOOK');
      expect(mapWebhook({ name: 'A', phone: '9876543210', source: 'walk-in' }, 'WEBSITE').source).toBe('WALK_IN');
      const odd = mapWebhook({ name: 'A', phone: '9876543210', source: 'Newspaper ad' }, 'WEBSITE');
      expect(odd.source).toBe('WEBSITE');
      expect(odd.source_detail).toBe('Newspaper ad');
    });

    it('flattens [{name, value}] lists', () => {
      expect(flattenPayload([{ name: 'email', value: 'a@b.co' }])).toEqual([['email', 'a@b.co']]);
    });

    it('spots honeypot spam', () => {
      expect(isHoneypotHit({ _gotcha: 'http://spam' })).toBe(true);
      expect(isHoneypotHit({ _gotcha: '' })).toBe(false);
    });
  });

  describe('access', () => {
    const me = { userId: 5, isManager: false };
    const boss = { userId: 1, isManager: true };
    it('salespeople see own, created and unassigned leads; managers see all', () => {
      expect(canSeeLead({ owner_id: 5 }, me)).toBe(true);
      expect(canSeeLead({ owner_id: null }, me)).toBe(true);
      expect(canSeeLead({ owner_id: 9, created_by: 5 }, me)).toBe(true);
      expect(canSeeLead({ owner_id: 9, created_by: 2 }, me)).toBe(false);
      expect(canSeeLead({ owner_id: 9, created_by: 2 }, boss)).toBe(true);
    });
    it('only managers assign; others claim unassigned leads', () => {
      expect(leadCapabilities({ owner_id: null }, me)).toMatchObject({ work: true, assign: false, claim: true, delete: false });
      expect(leadCapabilities({ owner_id: 5, created_by: 5 }, me)).toMatchObject({ claim: false, delete: true });
      expect(leadCapabilities({ owner_id: 9, created_by: 5 }, me).delete).toBe(false);
      expect(leadCapabilities({ owner_id: 9 }, boss)).toMatchObject({ assign: true, claim: false, delete: true });
      expect(shouldAutoClaim({ owner_id: null }, me)).toBe(true);
      expect(shouldAutoClaim({ owner_id: null }, boss)).toBe(false);
    });
  });

  describe('assignment', () => {
    it('round-robin rotates and skips people who lost access', () => {
      const s = { assign_mode: 'ROUND_ROBIN' as const, assign_user_ids: [3, 4, 7] };
      const eligible = [3, 7];
      const a = pickAssignee(s, eligible, 0);
      const b = pickAssignee(s, eligible, a.cursor);
      const c = pickAssignee(s, eligible, b.cursor);
      expect([a.ownerId, b.ownerId, c.ownerId]).toEqual([3, 7, 3]);
    });
    it('a fixed person or the pool', () => {
      expect(pickAssignee({ assign_mode: 'USER', assign_user_ids: [4] }, [4], 0).ownerId).toBe(4);
      expect(pickAssignee({ assign_mode: 'USER', assign_user_ids: [4] }, [], 0).ownerId).toBeNull();
      expect(pickAssignee({ assign_mode: 'POOL', assign_user_ids: [4] }, [4], 0).ownerId).toBeNull();
    });
    it('settings survive junk', () => {
      const s = parseSettings('{"assign_mode":"WEIRD","assign_user_ids":["2","x",2],"lead_source":"FACEBOOK","redirect_url":"javascript:alert(1)"}', 'WEBHOOK');
      expect(s).toEqual({ assign_mode: 'POOL', assign_user_ids: [2], lead_source: 'FACEBOOK', default_rating: null, redirect_url: null });
      expect(parseSettings('{"lead_source":"WEBSITE"}', 'INDIAMART').lead_source).toBe('INDIAMART');
      expect(parseSettings('not json', 'WEBHOOK').assign_mode).toBe('POOL');
    });
  });

  describe('follow-ups', () => {
    it('local day bounds in IST', () => {
      // 20:00 UTC on the 12th is 01:30 on the 13th in India.
      const { start, end } = localDayBounds(new Date('2026-11-12T20:00:00Z'), 330);
      expect(start.toISOString()).toBe('2026-11-12T18:30:00.000Z');
      expect(end.toISOString()).toBe('2026-11-13T18:30:00.000Z');
    });
    it('overdue / today / upcoming, only for open leads', () => {
      const now = new Date('2026-11-13T06:00:00Z');
      const { end } = localDayBounds(now, 330);
      expect(followUpState({ next_follow_up_at: '2026-11-13T05:00:00Z', stage: 'NEW' }, now, end)).toBe('OVERDUE');
      expect(followUpState({ next_follow_up_at: '2026-11-13T12:00:00Z', stage: 'QUOTED' }, now, end)).toBe('TODAY');
      expect(followUpState({ next_follow_up_at: '2026-11-14T05:00:00Z', stage: 'NEW' }, now, end)).toBe('UPCOMING');
      expect(followUpState({ next_follow_up_at: '2026-11-13T05:00:00Z', stage: 'WON' }, now, end)).toBeNull();
      expect(followUpState({ next_follow_up_at: null, stage: 'NEW' }, now, end)).toBeNull();
    });
  });

  describe('pipeline', () => {
    it('moves on contact and on quotation, never backwards', () => {
      expect(stageAfterContact('NEW')).toBe('CONTACTED');
      expect(stageAfterContact('QUOTED')).toBeNull();
      expect(stageAfterQuotation('QUALIFIED')).toBe('QUOTED');
      expect(stageAfterQuotation('NEGOTIATION')).toBeNull();
      expect(reachedPerson('CALL', 'NO_ANSWER')).toBe(false);
      expect(reachedPerson('CALL', 'CONNECTED')).toBe(true);
      expect(reachedPerson('WHATSAPP')).toBe(true);
      expect(reachedPerson('NOTE')).toBe(false);
    });
    it('furthest stage reached ignores LOST', () => {
      expect(furthestRank('LOST', ['CONTACTED', 'QUOTED'])).toBe(3);
      expect(furthestRank('WON', [])).toBe(5);
      expect(furthestRank('NEW', ['null'])).toBe(0);
    });
    it('median', () => {
      expect(median([])).toBeNull();
      expect(median([5, 1, 9])).toBe(5);
      expect(median([1, 2, 3, 10])).toBe(3);
    });
  });

  it('repeat enquiries only fill blanks', () => {
    const inbound = mapWebhook({ name: 'R', phone: '9123456789', email: 'r@x.in', company: 'New Co', city: 'Pune' }, 'WEBSITE');
    const patch = fillBlanks({ phone: '9876543210', alt_phone: null, email: null, company_name: 'Old Co', city: null }, inbound);
    expect(patch).toEqual({ email: 'r@x.in', city: 'Pune', alt_phone: '9123456789' });
  });

  it('CSV rows and source names', () => {
    expect(sourceFromText('IndiaMART')).toBe('INDIAMART');
    expect(sourceFromText('Instagram ads')).toBe('FACEBOOK');
    expect(sourceFromText('Walk in')).toBe('WALK_IN');
    expect(sourceFromText('???')).toBeNull();
    const l = mapImportRow({ company_name: 'Acme', phone: 9876543210, estimated_value: '₹ 1,50,000', source: 'Referral' }, 'OTHER');
    expect(l.name).toBe('Acme');
    expect(l.phone).toBe('9876543210');
    expect(l.estimated_value).toBe(150000);
    expect(l.source).toBe('REFERRAL');
  });
});
