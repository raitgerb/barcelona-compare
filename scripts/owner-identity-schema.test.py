#!/usr/bin/env python3
"""Zero-network SQLite rehearsal for the Phase 1 owner identity schema."""
from pathlib import Path
import sqlite3

MIGRATION = Path(__file__).parents[1] / 'migrations' / '0006_owner_identity.sql'


def main():
    db = sqlite3.connect(':memory:')
    db.executescript(MIGRATION.read_text())
    tables = {row[0] for row in db.execute("select name from sqlite_master where type='table'")}
    expected = {'owner_users', 'owner_contact_snapshots', 'owner_memberships', 'owner_verification_events', 'owner_identity_sessions'}
    assert expected <= tables, tables
    db.execute("insert into owner_users(user_id, created_at, updated_at) values ('u1', 'now', 'now')")
    db.execute("insert into owner_contact_snapshots(snapshot_id, place_id, user_id, phone_digest, source, eligibility_version, eligibility_disposition, captured_at) values ('s1','ChIJone','u1','digest','google_places','phone-self-service-eligibility-v1','eligible_unique_canonical','now')")
    db.execute("insert into owner_memberships(membership_id,user_id,place_id,state,source,created_at) values ('m1','u1','ChIJone','legacy_unverified','legacy_email','now')")
    db.execute("insert into owner_verification_events(event_id,membership_id,user_id,place_id,event_type,channel,occurred_at) values ('e1','m1','u1','ChIJone','legacy_imported','legacy_email','now')")
    db.execute("insert into owner_identity_sessions(session_id,token_digest,user_id,place_id,scope,issued_at,expires_at) values ('x1','td1','u1','ChIJone','owner_edit','now','2999-01-01')")
    assert db.execute("select state from owner_memberships where membership_id='m1'").fetchone()[0] == 'legacy_unverified'
    try:
        db.execute("insert into owner_contact_snapshots(snapshot_id,place_id,user_id,phone_digest,source,eligibility_version,eligibility_disposition,captured_at) values ('s2','ChIJone','u1','d2','google_places','v','ineligible_missing','now')")
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError('ineligible snapshot was accepted')
    db.execute("update owner_identity_sessions set revoked_at='now' where session_id='x1'")
    assert db.execute("select revoked_at from owner_identity_sessions where session_id='x1'").fetchone()[0] == 'now'
    # Rollback rehearsal: reverse dependency order, matching the migration comments.
    for table in ('owner_identity_sessions', 'owner_verification_events', 'owner_memberships', 'owner_contact_snapshots', 'owner_users'):
        db.execute(f'drop table {table}')
    assert not db.execute("select name from sqlite_master where type='table' and name like 'owner_%'").fetchall()
    print('owner identity schema rehearsal: 5 tables apply, constraints/state checks pass, rollback pass')


if __name__ == '__main__':
    main()
