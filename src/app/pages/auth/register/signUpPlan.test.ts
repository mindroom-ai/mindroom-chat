import { describe, expect, it } from 'vitest';
import type { IAuthData } from 'matrix-js-sdk';
import { chooseSignUpFlow, nextSignUpStage, planSignUp } from './registerUtil';

const TOKEN = 'm.login.registration_token';
const TERMS = 'm.login.terms';
const EMAIL = 'm.login.email.identity';
const DUMMY = 'm.login.dummy';

const flows = (...stageLists: string[][]): IAuthData => ({
  session: 'session',
  flows: stageLists.map((stages) => ({ stages })),
});

describe('planSignUp', () => {
  it('asks for nothing extra on an open server', () => {
    expect(planSignUp(flows([DUMMY]))).toEqual({
      token: undefined,
      email: undefined,
      terms: [],
      termsRequired: false,
    });
  });

  it('requires a registration token when every flow needs one, the unstable name included', () => {
    expect(planSignUp(flows([TOKEN], ['org.matrix.msc3231.login.registration_token']))?.token).toBe(
      'required'
    );
  });

  it('makes the token and the email optional when another flow does without them', () => {
    const plan = planSignUp(flows([TOKEN], [EMAIL], [DUMMY]));
    expect(plan?.token).toBe('optional');
    expect(plan?.email).toBe('optional');
  });

  it('ignores flows with stages this client cannot answer', () => {
    expect(planSignUp(flows(['m.login.sso']))).toBeUndefined();
    expect(planSignUp(flows(['m.login.sso'], [TOKEN]))?.token).toBe('required');
  });

  it('lists the policies in the app language, then English', () => {
    const authData: IAuthData = {
      ...flows([TERMS]),
      params: {
        [TERMS]: {
          policies: {
            privacy: {
              version: '1',
              en: { name: 'Privacy Policy', url: 'https://example.org/privacy-en' },
              nl: { name: 'Privacybeleid', url: 'https://example.org/privacy-nl' },
            },
            terms: { version: '2', en: { name: 'Terms', url: 'https://example.org/terms' } },
            broken: { version: '1', en: { name: 'No URL' } },
          },
        },
      },
    };
    const plan = planSignUp(authData, 'nl-NL');
    expect(plan?.termsRequired).toBe(true);
    expect(plan?.terms).toEqual([
      { id: 'privacy', name: 'Privacybeleid', url: 'https://example.org/privacy-nl' },
      { id: 'terms', name: 'Terms', url: 'https://example.org/terms' },
    ]);
  });
});

describe('chooseSignUpFlow', () => {
  it('uses a token the user typed even when a flow without one exists', () => {
    expect(chooseSignUpFlow(flows([DUMMY], [TOKEN]), { token: 'abc' })).toEqual([TOKEN]);
    expect(chooseSignUpFlow(flows([DUMMY], [TOKEN]), {})).toEqual([DUMMY]);
  });

  it('finds no flow when a required answer is missing', () => {
    expect(chooseSignUpFlow(flows([TOKEN, TERMS]), { token: 'abc' })).toBeUndefined();
    expect(chooseSignUpFlow(flows([TOKEN, TERMS]), { token: 'abc', acceptedTerms: true })).toEqual([
      TOKEN,
      TERMS,
    ]);
  });
});

describe('nextSignUpStage', () => {
  it('skips the stages the server marked completed', () => {
    expect(nextSignUpStage([TOKEN, TERMS], { completed: [TOKEN] })).toBe(TERMS);
    expect(nextSignUpStage([TOKEN, TERMS], { completed: [TOKEN, TERMS] })).toBeUndefined();
  });
});
