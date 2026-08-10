import { useCallback, useEffect, useRef, useState } from 'react';
import {
  finishTotpEnrollmentPoc,
  getEnrolledTotpFactorsPoc,
  startTotpEnrollmentPoc,
  type TotpEnrollmentDraft,
  type TotpFactorSummary,
} from '../services/totpMfaPoc';
import {
  totpMfaIssueFromError,
  validateTotpCode,
  type TotpMfaPocIssue,
} from '../lib/totpMfaPoc';

type Operation = 'generating' | 'enrolling' | null;

export function useTotpMfaPoc() {
  const [draft, setDraft] = useState<TotpEnrollmentDraft | null>(null);
  const [factors, setFactors] = useState<TotpFactorSummary[]>([]);
  const [code, setCode] = useState('');
  const [operation, setOperation] = useState<Operation>(null);
  const [issue, setIssue] = useState<TotpMfaPocIssue | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const operationLock = useRef(false);

  useEffect(() => {
    try {
      setFactors(getEnrolledTotpFactorsPoc());
    } catch (error) {
      setIssue(totpMfaIssueFromError(error));
    }
    // The draft belongs only to this hook instance. Unmounting releases the
    // reference; it is never written to persistent storage.
  }, []);

  const begin = useCallback((next: Exclude<Operation, null>) => {
    if (operationLock.current) return false;
    operationLock.current = true;
    setOperation(next);
    setIssue(null);
    setEnrolled(false);
    return true;
  }, []);

  const finish = useCallback(() => {
    operationLock.current = false;
    setOperation(null);
  }, []);

  const generate = useCallback(async () => {
    if (!begin('generating')) return;
    try {
      const nextDraft = await startTotpEnrollmentPoc();
      setDraft(nextDraft);
      setCode('');
    } catch (error) {
      setIssue(totpMfaIssueFromError(error));
    } finally {
      finish();
    }
  }, [begin, finish]);

  const enroll = useCallback(async () => {
    if (!draft || !begin('enrolling')) return;
    const localIssue = validateTotpCode(code.trim());
    if (localIssue) {
      setIssue(localIssue);
      finish();
      return;
    }
    try {
      const nextFactors = await finishTotpEnrollmentPoc(draft, code);
      setFactors(nextFactors);
      setEnrolled(true);
      setDraft(null);
      setCode('');
    } catch (error) {
      setIssue(totpMfaIssueFromError(error));
    } finally {
      finish();
    }
  }, [begin, code, draft, finish]);

  const discardDraft = useCallback(() => {
    if (operationLock.current) return;
    setDraft(null);
    setCode('');
    setIssue(null);
  }, []);

  return {
    busy: operation !== null,
    code,
    discardDraft,
    draft,
    enroll,
    enrolled,
    enrolling: operation === 'enrolling',
    factors,
    generate,
    generating: operation === 'generating',
    issue,
    setCode,
  };
}
