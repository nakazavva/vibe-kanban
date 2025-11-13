import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { containersApi } from '@/lib/api';
import { ServiceLogsViewer } from './environment/ServiceLogsViewer';
import { ServiceTerminal } from './environment/ServiceTerminal';
import type { ContainerServiceInfo } from 'shared/types';
import { Box, Copy, Globe, Loader2 } from 'lucide-react';

interface EnvironmentPanelProps {
  attemptId?: string;
}

const stateVariants: Record<
  string,
  { className: string; translationKey: string }
> = {
  running: { className: 'bg-green-100 text-green-700 border-green-200', translationKey: 'running' },
  exited: { className: 'bg-red-50 text-red-700 border-red-200', translationKey: 'exited' },
  dead: { className: 'bg-slate-200 text-slate-800 border-slate-300', translationKey: 'dead' },
  paused: { className: 'bg-amber-100 text-amber-700 border-amber-200', translationKey: 'paused' },
  created: { className: 'bg-muted text-muted-foreground border-border', translationKey: 'created' },
};

const getStateVariant = (state: string) => {
  return stateVariants[state.toLowerCase()] ?? stateVariants.created;
};

export function EnvironmentPanel({ attemptId }: EnvironmentPanelProps) {
  const { t } = useTranslation('tasks');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'logs' | 'terminal'>('info');
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartStatus, setRestartStatus] = useState<
    { type: 'success' | 'error'; message: string } | null
  >(null);

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['container-services', attemptId],
    queryFn: () => containersApi.listServices(attemptId!),
    enabled: Boolean(attemptId),
    refetchInterval: 15000,
  });

  const services: ContainerServiceInfo[] = data ?? [];

  useEffect(() => {
    if (!services.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !services.some((svc) => svc.containerName === selectedId)) {
      setSelectedId(services[0].containerName);
    }
  }, [services, selectedId]);

  const selectedService = useMemo(() => {
    return services.find((svc) => svc.containerName === selectedId) ?? null;
  }, [services, selectedId]);

  useEffect(() => {
    setRestartStatus(null);
    setIsRestarting(false);
  }, [selectedService?.containerName]);

  const handleRestart = async () => {
    if (!selectedService) return;
    setIsRestarting(true);
    setRestartStatus(null);
    try {
      await containersApi.restartService(selectedService.containerName);
      setRestartStatus({ type: 'success', message: t('environment.restart.success') });
      await refetch();
    } catch (err) {
      console.error(err);
      setRestartStatus({ type: 'error', message: t('environment.restart.error') });
    } finally {
      setIsRestarting(false);
    }
  };

  if (!attemptId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t('environment.noAttempt')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {t('environment.title')}
          </p>
          <h2 className="text-xl font-semibold">
          {selectedService?.composeProject ?? t('environment.sidebarTitle')}
          </h2>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('environment.actions.refresh')}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('environment.errors.title')}</AlertTitle>
          <AlertDescription>{t('environment.errors.generic')}</AlertDescription>
        </Alert>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="w-72 shrink-0 rounded-lg border bg-card shadow-sm">
          <div className="border-b px-4 py-3 text-sm font-semibold flex items-center gap-2">
            <Box className="h-4 w-4" />
            {t('environment.sidebarTitle')}
          </div>
          {isLoading ? (
            <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('environment.loading')}
            </div>
          ) : services.length === 0 ? (
            <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground text-center">
              {t('environment.empty')}
            </div>
          ) : (
            <div className="max-h-full overflow-y-auto">
              {services.map((service) => {
                const state = getStateVariant(service.state);
                return (
                  <button
                    type="button"
                    key={service.containerName}
                    onClick={() => {
                      setSelectedId(service.containerName);
                      setActiveTab('info');
                    }}
                    className={cn(
                      'w-full border-b px-4 py-3 text-left transition hover:bg-muted/60',
                      selectedService?.containerName === service.containerName && 'bg-muted'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{service.service}</p>
                        <p className="text-xs text-muted-foreground">
                          {service.containerName}
                        </p>
                      </div>
                      <Badge variant="secondary" className={cn('border', state.className)}>
                        {t(`environment.statuses.${state.translationKey}`)}
                      </Badge>
                    </div>
                    {service.ports.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {service.ports.join(', ')}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 rounded-lg border bg-card shadow-sm">
          {!selectedService ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('environment.selectPrompt')}
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as typeof activeTab)} className="flex h-full flex-col">
              <TabsList className="w-full justify-start border-b bg-background">
                <TabsTrigger value="info">{t('environment.tabs.info')}</TabsTrigger>
                <TabsTrigger value="logs">{t('environment.tabs.logs')}</TabsTrigger>
                <TabsTrigger value="terminal">{t('environment.tabs.terminal')}</TabsTrigger>
              </TabsList>
              <TabsContent value="info" className="flex-1 p-4">
                <Card className="border-none shadow-none">
                  <CardHeader className="px-0 pt-0">
                    <CardTitle>{selectedService.service}</CardTitle>
                    <CardDescription>{selectedService.status}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 px-0">
                    <InfoRow
                      label={t('environment.fields.compose')}
                      value={selectedService.composeProject}
                    />
                    <InfoRow
                      label={t('environment.fields.image')}
                      value={selectedService.image}
                    />
                    <InfoRow
                      label={t('environment.fields.domain')}
                      value={selectedService.browserUrl ?? t('environment.domainUnavailable')}
                      action={
                        selectedService.browserUrl ? (
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => window.open(selectedService.browserUrl!, '_blank')}
                            >
                              <Globe className="mr-1 h-4 w-4" />
                              {t('environment.actions.openBrowser')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                navigator.clipboard
                                  .writeText(selectedService.browserUrl!)
                                  .catch(() => {})
                              }
                            >
                              <Copy className="mr-1 h-4 w-4" />
                              {t('environment.actions.copyUrl')}
                            </Button>
                          </div>
                        ) : null
                      }
                    />
                    <InfoRow
                      label={t('environment.fields.ports')}
                      value={
                        selectedService.ports.length
                          ? selectedService.ports.join(', ')
                          : t('environment.noPorts')
                      }
                    />
                    <div className="rounded-md border bg-muted/40 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">
                            {t('environment.restart.title')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t('environment.restart.helper')}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleRestart}
                          disabled={isRestarting}
                        >
                          {isRestarting && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          {t('environment.actions.restart')}
                        </Button>
                      </div>
                      {restartStatus && (
                        <p
                          className={cn(
                            'mt-2 text-xs',
                            restartStatus.type === 'success'
                              ? 'text-green-600'
                              : 'text-red-600'
                          )}
                        >
                          {restartStatus.message}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="logs" className="flex-1">
                <ServiceLogsViewer containerName={selectedService.containerName} />
              </TabsContent>
              <TabsContent value="terminal" className="flex-1">
                <ServiceTerminal containerName={selectedService.containerName} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}

const InfoRow = ({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: ReactNode;
}) => (
  <div className="flex flex-col gap-1 text-sm">
    <span className="text-xs uppercase tracking-wider text-muted-foreground">
      {label}
    </span>
    <span className="font-medium break-all">{value}</span>
    {action}
  </div>
);
