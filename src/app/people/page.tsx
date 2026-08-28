'use client';

/**
 * Who may use this, and what each of them may do.
 *
 * This screen exists so that granting access never again requires a
 * service-account key, a terminal and somebody who knows where the script is.
 * It is restricted to the owner, and it is honest about the one thing that
 * makes this power different from every other permission in the system:
 * whoever holds it can give it to themselves, so the only real control is who
 * holds it.
 *
 * Two deliberate refusals, both enforced server-side rather than here:
 *   · the last owner cannot be demoted or removed — there would be nobody left
 *     who could ever grant a role again;
 *   · a role change signs that person out, because a permission that takes an
 *     hour to be taken away has not really been taken away.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../../lib/auth/AuthProvider';
import { invitePerson, listPeople, setUserRole, type PersonRow } from '../../lib/people/manage';
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../lib/auth/roles';
import { alreadyInvited, looksLikeEmail } from '../../domain/userAdmin';
import type { Role } from '../../domain/types';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import { colour, radius, type } from '../../design/tokens';
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  hint,
  input as inputStyle,
  label as labelStyle,
  tableCell,
  tableHead,
} from '../../design/ui';

export default function PeoplePage() {
  const { user, can } = useAuth();

  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setPeople(await listPeople());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The list of people could not be loaded.');
      setPeople([]);
    }
  }, []);

  const mayManage = can('manageUsers');

  useEffect(() => {
    if (mayManage) void refresh();
  }, [mayManage, refresh]);

  if (!user) return null;

  if (!mayManage) {
    return (
      <>
        <PageHeader title="People" />
        <EmptyState title="This one is not yours">
          <p>
            Only an owner can see who has access or change it. If that should be you, ask
            whoever set the system up.
          </p>
        </EmptyState>
      </>
    );
  }

  async function change(person: PersonRow, next: Role | null) {
    const itsYou = person.uid === user!.uid;
    setBusy(person.uid);
    setNotice(null);
    setError(null);
    try {
      await setUserRole(person.uid, next);
      // Changing a role revokes that person's token, so changing your own ends
      // your session. Reloading the list first would just fail on the way out.
      if (itsYou) {
        setNotice('You changed your own role, so you will be signed out. Sign in again to carry on.');
        return;
      }
      await refresh();
      setNotice(
        next === null
          ? `${person.email ?? 'That account'} no longer has access.`
          : `${person.email ?? 'That account'} is now ${ROLE_LABELS[next]}. They will be asked to sign in again.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="People"
        meta={
          people
            ? `${people.length} ${people.length === 1 ? 'account' : 'accounts'}`
            : 'Loading…'
        }
        actions={
          <button
            type="button"
            style={inviting ? buttonQuiet : buttonPrimary}
            onClick={() => {
              setInviting((v) => !v);
              setNotice(null);
              setError(null);
            }}
          >
            {inviting ? 'Cancel' : 'Invite somebody'}
          </button>
        }
      />

      {inviting ? (
        <InviteForm
          people={people ?? []}
          onDone={async (message) => {
            setInviting(false);
            setNotice(message);
            await refresh();
          }}
          onError={setError}
        />
      ) : null}

      {notice ? <p style={S.notice}>{notice}</p> : null}
      {error ? <p style={S.error}>{error}</p> : null}

      {people === null ? (
        <p style={hint}>Looking up who has access…</p>
      ) : people.length === 0 ? (
        <EmptyState title="Nobody yet">
          <p>Invite the first person and choose what they may do.</p>
        </EmptyState>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Person</th>
              <th style={S.th}>May do</th>
              <th style={S.th}>Last signed in</th>
              <th style={S.th} />
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.uid}>
                <td style={S.td}>
                  <span style={{ display: 'block' }}>{person.email ?? person.uid}</span>
                  {person.uid === user.uid ? <em style={S.you}>you</em> : null}
                  {person.awaitingFirstSignIn ? (
                    <em style={S.pending}>invited · not signed in yet</em>
                  ) : null}
                </td>

                <td style={S.td}>
                  <select
                    value={person.role ?? ''}
                    disabled={busy !== null}
                    style={S.select}
                    onChange={(event) =>
                      void change(person, (event.target.value || null) as Role | null)
                    }
                  >
                    <option value="">No access</option>
                    {ASSIGNABLE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                    {/* A retired role still on an old account. Shown so the row
                        tells the truth, and it disappears once changed. */}
                    {person.role === 'admin' ? <option value="admin">{ROLE_LABELS.admin}</option> : null}
                  </select>
                  <span style={S.roleNote}>
                    {person.role ? ROLE_DESCRIPTIONS[person.role] : 'Can sign in and see nothing.'}
                  </span>
                </td>

                <td style={{ ...S.td, color: colour.muted, whiteSpace: 'nowrap' }}>
                  {person.lastSignInAt ? person.lastSignInAt.slice(0, 10) : '—'}
                </td>

                <td style={{ ...S.td, textAlign: 'right' }}>
                  {person.role === null ? null : (
                    <button
                      type="button"
                      style={S.remove}
                      disabled={busy !== null}
                      onClick={() => void change(person, null)}
                    >
                      {busy === person.uid ? 'Saving…' : 'Remove access'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ ...hint, marginTop: 22, maxWidth: '66ch' }}>
        Removing access leaves the account and everything it did in place — it simply
        stops working. Accounts are never deleted from here, because a person who
        approved a budget last spring is part of that budget&rsquo;s history.
      </p>
      <p style={{ ...hint, marginTop: 8, maxWidth: '66ch' }}>
        Owners can grant any role, including owner, which means an owner can hand
        somebody the ability to remove them. Give it to the people who would be
        entitled to it anyway.
      </p>
    </>
  );
}

/**
 * Inviting somebody.
 *
 * No password is chosen here or anywhere else. The account is created with a
 * random one that is thrown away, and the person sets their own from the email.
 */
function InviteForm({
  people,
  onDone,
  onError,
}: {
  people: PersonRow[];
  onDone: (message: string) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('producer');
  const [sending, setSending] = useState(false);

  const existing = alreadyInvited(people, email);
  const valid = looksLikeEmail(email);

  return (
    <form
      style={S.panel}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!valid || sending) return;
        setSending(true);
        try {
          const result = await invitePerson(email, role);
          await onDone(
            result.emailSent
              ? `${result.email} has been ${result.created ? 'invited' : 'given access'}. They will get an email with a link to set a password.`
              : `${result.email} has access, but the email did not go out. Ask them to use “forgotten password” on the sign-in screen.`,
          );
        } catch (err) {
          onError(err instanceof Error ? err.message : 'The invitation could not be sent.');
        } finally {
          setSending(false);
        }
      }}
    >
      <div style={S.panelRow}>
        <label style={labelStyle}>
          Email address
          <input
            type="email"
            value={email}
            autoFocus
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@allforlove.london"
            style={{ ...inputStyle, minWidth: 300 }}
          />
        </label>

        <label style={labelStyle}>
          What they may do
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            style={{ ...inputStyle, minWidth: 180 }}
          >
            {ASSIGNABLE_ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" style={buttonPrimary} disabled={!valid || sending}>
          {sending ? 'Sending…' : 'Send invitation'}
        </button>
      </div>

      <p style={{ ...hint, marginTop: 10, maxWidth: '62ch' }}>{ROLE_DESCRIPTIONS[role]}</p>

      {existing ? (
        <p style={{ ...hint, marginTop: 6, maxWidth: '62ch' }}>
          {existing.email} already has an account
          {existing.role ? ` as ${ROLE_LABELS[existing.role]}` : ' with no role'}. Sending this
          will change what they may do, not create a second account.
        </p>
      ) : (
        <p style={{ ...hint, marginTop: 6, maxWidth: '62ch' }}>
          They choose their own password from the email. Nobody here ever sees it.
        </p>
      )}
    </form>
  );
}

const S: Record<string, React.CSSProperties> = {
  panel: {
    border: `1px solid ${colour.rule}`,
    borderLeft: `3px solid ${colour.blush}`,
    borderRadius: radius.base,
    padding: '18px 20px',
    marginBottom: 26,
  },
  panelRow: { display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' },

  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: tableHead,
  td: { ...tableCell, verticalAlign: 'top', padding: '12px 10px 12px 0' },

  you: {
    display: 'block',
    fontStyle: 'normal',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: type.trackingNav,
    textTransform: 'uppercase',
    color: colour.muted,
    marginTop: 3,
  },
  pending: { display: 'block', fontStyle: 'normal', fontSize: 12, color: colour.muted, marginTop: 3 },

  select: { ...inputStyle, minWidth: 170, marginTop: 0 },
  roleNote: { display: 'block', fontSize: 12, color: colour.muted, marginTop: 5, maxWidth: '34ch' },

  remove: { ...buttonSecondary, fontSize: 11, padding: '7px 12px' },

  notice: { fontSize: 14, marginBottom: 16 },
  error: { fontSize: 13, color: colour.signature, marginBottom: 16 },
};
