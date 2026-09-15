import React, {
  ComponentType,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, Button, Icon, IconButton, Icons, Spinner, Text } from 'folds';
import type { MatrixClient } from 'matrix-js-sdk';
import { ComputerApiError, ComputerSessionClient, createComputerSession } from './api';
import type { ComputerScreenProps } from './ComputerScreen';
import type { ComputerAgent, ComputerStatus, ComputerStreamConnection } from './types';
import { sendComputerContinuation } from './continuation';
import * as css from './ComputerPanel.css';

const LazyComputerScreen = lazy(() => import('./ComputerScreen'));

type PanelPhase = 'selecting' | 'connecting' | 'ready' | 'disconnected' | 'stopped' | 'error';
type PanelOperation = 'take' | 'resume' | 'stop' | 'reconnect';

export type ComputerPanelProps = {
  agents: readonly ComputerAgent[];
  apiUrl: string;
  mx: MatrixClient;
  roomId: string;
  threadId?: string;
  onClose: () => void;
  request?: typeof fetch;
  ScreenComponent?: ComponentType<ComputerScreenProps>;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof ComputerApiError) {
    if (error.status === 401) return 'Your computer session expired. Start a new session.';
    return error.message;
  }
  return 'Unable to open the computer.';
};

const phaseLabel = (
  phase: PanelPhase,
  status: ComputerStatus | undefined,
  connected: boolean
): string => {
  if (phase === 'connecting') return 'Connecting to computer…';
  if (phase === 'stopped') return 'Computer stopped';
  if (phase === 'disconnected') return 'Computer disconnected';
  if (phase === 'error') return 'Computer unavailable';
  if (phase === 'selecting') return 'Choose an agent to watch its computer.';
  if (status?.state === 'starting') return 'Computer is starting…';
  if (!connected) return 'Connecting display…';
  return status?.mode === 'control' ? 'You have control' : 'Watch mode';
};

export function ComputerPanel({
  agents,
  apiUrl,
  mx,
  roomId,
  threadId,
  onClose,
  request,
  ScreenComponent = LazyComputerScreen,
}: ComputerPanelProps) {
  const [chosenAgentId, setChosenAgentId] = useState<string>();
  const [activeAgentId, setActiveAgentId] = useState<string>();
  const [restart, setRestart] = useState(0);
  const [phase, setPhase] = useState<PanelPhase>('selecting');
  const [operation, setOperation] = useState<PanelOperation>();
  const [status, setStatus] = useState<ComputerStatus>();
  const [stream, setStream] = useState<ComputerStreamConnection>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const [sendError, setSendError] = useState<string>();
  const [releaseNotice, setReleaseNotice] = useState<'released' | 'sent'>();
  const sessionRef = useRef<ComputerSessionClient>();
  const lifecycleRef = useRef(0);
  const activeStreamTicketRef = useRef<string>();
  const disposedSessionsRef = useRef(new WeakSet<ComputerSessionClient>());

  const chosenAgent = useMemo(
    () => agents.find((agent) => agent.userId === chosenAgentId),
    [agents, chosenAgentId]
  );
  const selectedAgent = useMemo(
    () =>
      agents.length === 1 ? agents[0] : agents.find((agent) => agent.userId === activeAgentId),
    [activeAgentId, agents]
  );
  const selectedAgentUserId = selectedAgent?.userId;

  const disposeSession = useCallback((session: ComputerSessionClient) => {
    if (disposedSessionsRef.current.has(session)) return;
    disposedSessionsRef.current.add(session);
    void session.dispose().catch(() => undefined);
  }, []);

  const connectStream = useCallback(
    async (
      session: ComputerSessionClient,
      lifecycle: number,
      refreshStatus: boolean
    ): Promise<void> => {
      const nextStatus = refreshStatus ? await session.refreshStatus() : session.status;
      if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
      if (nextStatus.state === 'stopped') {
        disposedSessionsRef.current.add(session);
        sessionRef.current = undefined;
        setStatus(nextStatus);
        setStream(undefined);
        setConnected(false);
        setPhase('stopped');
        return;
      }
      const nextStream = await session.createStream();
      if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
      setStatus(nextStatus);
      setConnected(false);
      activeStreamTicketRef.current = nextStream.protocols[1];
      setStream(nextStream);
      setPhase('ready');
    },
    []
  );

  useEffect(() => {
    const lifecycle = lifecycleRef.current + 1;
    lifecycleRef.current = lifecycle;
    const abortController = new AbortController();
    let createdSession: ComputerSessionClient | undefined;

    setStatus(undefined);
    activeStreamTicketRef.current = undefined;
    setStream(undefined);
    setConnected(false);
    setError(undefined);
    setSendError(undefined);
    setReleaseNotice(undefined);
    setOperation(undefined);

    if (!selectedAgentUserId) {
      setPhase('selecting');
      return () => {
        abortController.abort();
      };
    }

    setPhase('connecting');
    const createSession = async () => {
      try {
        const openIdToken = await mx.getOpenIdToken();
        if (lifecycleRef.current !== lifecycle) return;
        createdSession = await createComputerSession({
          apiUrl,
          agentUserId: selectedAgentUserId,
          openIdToken,
          request,
          roomId,
          signal: abortController.signal,
        });
        if (lifecycleRef.current !== lifecycle) {
          disposeSession(createdSession);
          return;
        }
        sessionRef.current = createdSession;
        setStatus(createdSession.status);
        await connectStream(createdSession, lifecycle, false);
      } catch (sessionError) {
        if (lifecycleRef.current !== lifecycle) return;
        setError(getErrorMessage(sessionError));
        setPhase('error');
      }
    };
    void createSession();

    return () => {
      abortController.abort();
      if (lifecycleRef.current === lifecycle) {
        lifecycleRef.current += 1;
        activeStreamTicketRef.current = undefined;
      }
      if (createdSession) disposeSession(createdSession);
      if (sessionRef.current === createdSession) sessionRef.current = undefined;
    };
  }, [
    apiUrl,
    connectStream,
    disposeSession,
    mx,
    request,
    restart,
    roomId,
    selectedAgentUserId,
    threadId,
  ]);

  const handleTakeControl = async () => {
    const session = sessionRef.current;
    if (!session || operation) return;
    const lifecycle = lifecycleRef.current;
    setOperation('take');
    setError(undefined);
    try {
      const nextStatus = await session.control('take');
      if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
      setStatus(nextStatus);
      setReleaseNotice(undefined);
      setSendError(undefined);
    } catch (controlError) {
      if (lifecycleRef.current === lifecycle) {
        setError(getErrorMessage(controlError));
        setPhase('ready');
      }
    } finally {
      if (lifecycleRef.current === lifecycle) setOperation(undefined);
    }
  };

  const handleResumeAgent = async () => {
    const session = sessionRef.current;
    if (!session || operation || !selectedAgentUserId) return;
    const lifecycle = lifecycleRef.current;
    setOperation('resume');
    setError(undefined);
    setSendError(undefined);
    setReleaseNotice(undefined);
    try {
      const nextStatus = await session.control('release');
      if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
      setStatus(nextStatus);
      activeStreamTicketRef.current = undefined;
      setStream(undefined);
      setConnected(false);
      setReleaseNotice('released');

      const continuation = sendComputerContinuation(mx, roomId, threadId, selectedAgentUserId);
      const reconnect = connectStream(session, lifecycle, false);
      const [continuationResult, reconnectResult] = await Promise.allSettled([
        continuation,
        reconnect,
      ]);
      if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
      if (continuationResult.status === 'rejected') {
        setSendError('Control was released, but the continuation message could not be sent.');
      } else {
        setReleaseNotice('sent');
      }
      if (reconnectResult.status === 'rejected') {
        setError(getErrorMessage(reconnectResult.reason));
        setPhase('disconnected');
      }
    } catch (releaseError) {
      if (lifecycleRef.current === lifecycle) {
        setError(`Control was not released. ${getErrorMessage(releaseError)}`);
        setPhase('ready');
      }
    } finally {
      if (lifecycleRef.current === lifecycle) setOperation(undefined);
    }
  };

  const handleStop = async () => {
    const session = sessionRef.current;
    if (!session || operation) return;
    const lifecycle = lifecycleRef.current;
    setOperation('stop');
    setError(undefined);
    try {
      const nextStatus = await session.control('stop');
      if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
      disposedSessionsRef.current.add(session);
      sessionRef.current = undefined;
      setStatus(nextStatus);
      activeStreamTicketRef.current = undefined;
      setStream(undefined);
      setConnected(false);
      setPhase('stopped');
    } catch (stopError) {
      if (lifecycleRef.current === lifecycle) {
        setError(getErrorMessage(stopError));
        setPhase('ready');
      }
    } finally {
      if (lifecycleRef.current === lifecycle) setOperation(undefined);
    }
  };

  const handleReconnect = async () => {
    if (operation) return;
    const session = sessionRef.current;
    if (!session) {
      setRestart((value) => value + 1);
      return;
    }
    const lifecycle = lifecycleRef.current;
    setOperation('reconnect');
    setError(undefined);
    setPhase('connecting');
    try {
      await connectStream(session, lifecycle, true);
    } catch (reconnectError) {
      if (lifecycleRef.current === lifecycle) {
        if (reconnectError instanceof ComputerApiError && reconnectError.status === 401) {
          disposedSessionsRef.current.add(session);
          sessionRef.current = undefined;
        }
        setError(getErrorMessage(reconnectError));
        setPhase('disconnected');
      }
    } finally {
      if (lifecycleRef.current === lifecycle) setOperation(undefined);
    }
  };

  const handleClose = () => {
    const session = sessionRef.current;
    if (session) {
      sessionRef.current = undefined;
      disposeSession(session);
    }
    activeStreamTicketRef.current = undefined;
    onClose();
  };

  const handleDisconnected = (streamTicket: string, message?: string) => {
    if (activeStreamTicketRef.current !== streamTicket) return;
    if (!sessionRef.current || operation === 'stop') return;
    activeStreamTicketRef.current = undefined;
    setConnected(false);
    setStream(undefined);
    setError(message ?? 'The computer connection closed.');
    setPhase('disconnected');
  };

  const statusText = phaseLabel(phase, status, connected);
  const canControl = phase === 'ready' && connected && status?.state === 'ready';

  return (
    <aside className={css.Panel} aria-label="Computer panel">
      <div className={css.Header}>
        <Box alignItems="Center" gap="200">
          <Icon size="300" src={Icons.Monitor} />
          <Text size="H4">Computer</Text>
        </Box>
        <IconButton onClick={handleClose} aria-label="Close computer" size="300">
          <Icon size="300" src={Icons.Cross} />
        </IconButton>
      </div>

      <div className={css.Body}>
        {agents.length > 1 && (
          <label htmlFor="mindroom-computer-agent">
            <Text size="L400">Agent</Text>
            <select
              id="mindroom-computer-agent"
              className={css.AgentSelect}
              aria-label="Agent"
              value={chosenAgent?.userId ?? ''}
              onChange={(event) => {
                const nextAgentId = event.currentTarget.value || undefined;
                setChosenAgentId(nextAgentId);
                if (nextAgentId !== activeAgentId) setActiveAgentId(undefined);
              }}
            >
              <option value="">Choose an agent</option>
              {agents.map((agent) => (
                <option key={agent.userId} value={agent.userId}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {stream && (
          <div className={css.ScreenFrame}>
            <Suspense fallback={<Spinner variant="Secondary" size="300" />}>
              <ScreenComponent
                key={`${stream.url}:${stream.protocols[1]}`}
                mode={status?.mode ?? 'view'}
                onConnected={() => {
                  setConnected(true);
                  setPhase('ready');
                  setError(undefined);
                }}
                onDisconnected={(message) => handleDisconnected(stream.protocols[1], message)}
                protocols={stream.protocols}
                url={stream.url}
              />
            </Suspense>
          </div>
        )}

        {!stream && phase === 'connecting' && (
          <Box grow="Yes" alignItems="Center" justifyContent="Center" gap="200">
            <Spinner variant="Secondary" size="300" />
            <Text>Connecting…</Text>
          </Box>
        )}

        <Text className={css.Status} size="T300" role="status">
          {statusText}
        </Text>
        {releaseNotice && (
          <Text size="T300">
            Control released.{releaseNotice === 'sent' && ' The agent was asked to continue.'}
          </Text>
        )}
        {error && (
          <Text className={css.Error} size="T300" role="alert">
            {error}
          </Text>
        )}
        {sendError && (
          <Text className={css.Error} size="T300" role="alert">
            {sendError}
          </Text>
        )}

        <div className={css.Actions}>
          {phase === 'selecting' && (
            <Button
              disabled={!chosenAgent}
              onClick={() => {
                if (chosenAgent) setActiveAgentId(chosenAgent.userId);
              }}
              size="300"
              variant="Primary"
            >
              <Text>Watch computer</Text>
            </Button>
          )}
          {canControl && status?.mode === 'view' && (
            <Button disabled={!!operation} onClick={handleTakeControl} size="300" variant="Primary">
              <Text>{operation === 'take' ? 'Taking control…' : 'Take control'}</Text>
            </Button>
          )}
          {status?.mode === 'control' && phase === 'ready' && (
            <Button disabled={!!operation} onClick={handleResumeAgent} size="300" variant="Primary">
              <Text>{operation === 'resume' ? 'Releasing…' : 'Resume agent'}</Text>
            </Button>
          )}
          {(phase === 'disconnected' || phase === 'error') && (
            <Button disabled={!!operation} onClick={handleReconnect} size="300" variant="Secondary">
              <Text>Reconnect</Text>
            </Button>
          )}
          {phase === 'stopped' && (
            <Button onClick={handleReconnect} size="300" variant="Primary">
              <Text>Start computer</Text>
            </Button>
          )}
          {sessionRef.current && phase !== 'stopped' && (
            <Button disabled={!!operation} onClick={handleStop} size="300" variant="Critical">
              <Text>{operation === 'stop' ? 'Stopping…' : 'Stop'}</Text>
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
