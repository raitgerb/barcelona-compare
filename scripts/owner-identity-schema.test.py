#!/usr/bin/env python3
"""Zero-network SQLite rehearsal for the Phase 1 owner identity schema."""
from pathlib import Path
import sqlite3

MIGRATION = Path(__file__).parents[1] / 'migrations' / '0006_owner_identity.sql'


def main():
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys = ON')
    db.executescript(MIGRATION.read_text())
    tables = {row[0] for row in db.execute("select name from sqlite_master where type='table'")}
    expected = {'owner_users', 'owner_contact_snapshots', 'owner_memberships', 'owner_verification_events', 'owner_identity_sessions'}
    assert expected <= tables, tables
    db.execute("insert into owner_users(user_id, created_at, updated_at) values ('u1', 'now', 'now')")
    db.execute("insert into owner_contact_snapshots(snapshot_id, place_id, user_id, phone_digest, source, eligibility_version, eligibility_disposition, captured_at) values ('s1','ChIJone','u1','digest','google_places','phone-self-service-eligibility-v1','eligible_unique_canonical','now')")
    db.execute("insert into owner_memberships(membership_id,user_id,place_id,state,source,created_at) values ('m1','u1','ChIJone','legacy_unverified','legacy_email','now')")
    # Ensure the mismatched-user case reaches the composite membership/user/place
    # foreign key rather than failing on the ordinary user foreign key first.
    db.execute("insert into owner_users(user_id, created_at, updated_at) values ('u2', 'now', 'now')")
    db.execute("insert into owner_verification_events(event_id,membership_id,user_id,place_id,event_type,channel,occurred_at) values ('e1','m1','u1','ChIJone','legacy_imported','legacy_email','now')")
    db.execute("insert into owner_verification_events(event_id,membership_id,user_id,place_id,event_type,channel,eligibility_version,occurred_at) values ('e2','m1','u1','ChIJone','admitted','phone','phone-self-service-eligibility-v1','now')")
    # A verification event must identify the same user and Place ID as its membership.
    mismatch_cases = (
        ("mismatched user", 'e-mismatch-user', 'u2', 'ChIJone'),
        ("mismatched place", 'e-mismatch-place', 'u1', 'ChIJtwo'),
    )
    for label, event_id, user_id, place_id in mismatch_cases:
        try:
            db.execute("insert into owner_verification_events(event_id,membership_id,user_id,place_id,event_type,channel,eligibility_version,occurred_at) values (?,?,?,?,?,?,?,?)", (event_id, 'm1', user_id, place_id, 'verified', 'phone', 'phone-self-service-eligibility-v1', 'now'))
        except sqlite3.IntegrityError:
            pass
        else:
            raise AssertionError(f'{label} event was accepted')
    db.execute("insert into owner_identity_sessions(session_id,token_digest,user_id,place_id,scope,issued_at,expires_at) values ('x1','td1','u1','ChIJone','owner_edit','now','2999-01-01')")
    assert db.execute("select state from owner_memberships where membership_id='m1'").fetchone()[0] == 'legacy_unverified'
    # The idempotency key is the user/place/role tuple: duplicates reject deterministically,
    # while another user or place remains a valid membership.
    duplicate_cases = (
        ("duplicate tuple", 'm1', 'u1', 'ChIJone', True),
        ("different user", 'm2', 'u2', 'ChIJone', False),
        ("different place", 'm3', 'u1', 'ChIJtwo', False),
    )
    for label, membership_id, user_id, place_id, should_reject in duplicate_cases:
        try:
            db.execute("insert into owner_memberships(membership_id,user_id,place_id,state,source,created_at) values (?,?,?,?,?,?)", (membership_id, user_id, place_id, 'verified', 'phone_manifest', 'now'))
        except sqlite3.IntegrityError:
            if not should_reject:
                raise AssertionError(f'{label} membership was rejected')
        else:
            if should_reject:
                raise AssertionError(f'{label} membership was accepted')
    assert db.execute("select count(*) from owner_memberships").fetchone()[0] == 3
    # Foreign-key enforcement must reject orphan rows in every dependent table.
    orphan_cases = (
        ("contact snapshot", "insert into owner_contact_snapshots(snapshot_id,place_id,user_id,phone_digest,source,eligibility_version,eligibility_disposition,captured_at) values ('orphan-s','ChIJorphan','missing-user','d','google_places','phone-self-service-eligibility-v1','eligible_unique_canonical','now')"),
        ("membership", "insert into owner_memberships(membership_id,user_id,place_id,state,source,created_at) values ('orphan-m','missing-user','ChIJorphan','verified','phone_manifest','now')"),
        ("verification event", "insert into owner_verification_events(event_id,membership_id,user_id,place_id,event_type,channel,occurred_at) values ('orphan-e','missing-membership','missing-user','ChIJorphan','verified','phone','now')"),
        ("session", "insert into owner_identity_sessions(session_id,token_digest,user_id,place_id,scope,issued_at,expires_at) values ('orphan-x','orphan-token','missing-user','ChIJorphan','owner_edit','now','2999-01-01')"),
    )
    for label, statement in orphan_cases:
        try:
            db.execute(statement)
        except sqlite3.IntegrityError:
            pass
        else:
            raise AssertionError(f'orphan {label} was accepted')
    try:
        db.execute("insert into owner_contact_snapshots(snapshot_id,place_id,user_id,phone_digest,source,eligibility_version,eligibility_disposition,captured_at) values ('s2','ChIJone','u1','d2','google_places','v','ineligible_missing','now')")
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError('ineligible snapshot was accepted')
    try:
        db.execute("insert into owner_contact_snapshots(snapshot_id,place_id,user_id,phone_digest,source,eligibility_version,eligibility_disposition,captured_at) values ('s3','ChIJthree','u1','d3','google_places','arbitrary-version','eligible_unique_canonical','now')")
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError('arbitrary eligibility version was accepted')
    # Every verification event has an explicit channel/version contract: legacy
    # imports carry no manifest version; phone events carry the exact manifest.
    event_version_cases = (
        ('legacy NULL', 'e3', 'legacy_imported', 'legacy_email', None, False),
        ('phone exact', 'e4', 'verified', 'phone', 'phone-self-service-eligibility-v1', False),
        ('phone arbitrary', 'e5', 'verified', 'phone', 'arbitrary-version', True),
        ('legacy arbitrary', 'e6', 'legacy_imported', 'legacy_email', 'arbitrary-version', True),
    )
    for label, event_id, event_type, channel, version, should_reject in event_version_cases:
        try:
            db.execute("insert into owner_verification_events(event_id,membership_id,user_id,place_id,event_type,channel,eligibility_version,occurred_at) values (?,?,?,?,?,?,?,?)", (event_id, 'm1', 'u1', 'ChIJone', event_type, channel, version, 'now'))
        except sqlite3.IntegrityError:
            if not should_reject:
                raise AssertionError(f'{label} event was rejected')
        else:
            if should_reject:
                raise AssertionError(f'{label} event was accepted')
    db.execute("update owner_identity_sessions set revoked_at='now' where session_id='x1'")
    assert db.execute("select revoked_at from owner_identity_sessions where session_id='x1'").fetchone()[0] == 'now'
    # Rollback rehearsal: reverse dependency order, matching the migration comments.
    for table in ('owner_identity_sessions', 'owner_verification_events', 'owner_memberships', 'owner_contact_snapshots', 'owner_users'):
        db.execute(f'drop table {table}')
    assert not db.execute("select name from sqlite_master where type='table' and name like 'owner_%'").fetchall()
    print('owner identity schema rehearsal: 5 tables apply, constraints/state checks pass, rollback pass')


if __name__ == '__main__':
    main()
