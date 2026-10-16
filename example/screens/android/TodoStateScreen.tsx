// PoC for issue #343 (in-widget state). Throwaway configuration screen for the two Todo Dynamic
// Widgets: push items, pin, inspect and reset each placement's state record, read the events the
// widgets queued while the app was not involved, and switch the PoC flags.
import { useRouter } from 'expo-router'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  drainAndroidDynamicWidgetEvents,
  getActiveWidgets,
  readAndroidDynamicWidgetState,
  requestPinAndroidWidget,
  resetAndroidDynamicWidgetState,
  setAndroidDynamicWidgetStateFlags,
  updateAndroidDynamicWidget,
  type AndroidDynamicWidgetInteractionEvent,
  type AndroidDynamicWidgetStateFlags,
  type AndroidDynamicWidgetStateSnapshot,
  type WidgetInfo,
} from '@use-voltra/android-client'

import { Button } from '~/components/Button'
import { Card } from '~/components/Card'
import { ScreenLayout } from '~/components/ScreenLayout'

const TODO_WIDGET_IDS = ['TodoStateWidget', 'TodoStateKeyWidget'] as const
type TodoWidgetId = (typeof TODO_WIDGET_IDS)[number]

const WIDGET_LABELS: Record<TodoWidgetId, string> = {
  TodoStateWidget: 'Todo · onInteraction (option C)',
  TodoStateKeyWidget: 'Todo · stateKey (option D)',
}

type TodoItem = { id: string; title: string }

const INITIAL_ITEMS: TodoItem[] = [
  { id: 't1', title: 'Buy 🍞' },
  { id: 't2', title: 'Water the plants' },
  { id: 't3', title: 'Call the dentist' },
]

type Placement = {
  widget: WidgetInfo
  snapshot: AndroidDynamicWidgetStateSnapshot | null
  error: string | null
}

type Scope = 'placement' | 'widgetScope'
type Precedence = 'survive' | 'resetOnPush'

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const isTodoWidget = (widget: WidgetInfo): widget is WidgetInfo & { widgetType: TodoWidgetId } =>
  (TODO_WIDGET_IDS as readonly string[]).includes(widget.widgetType)

const nextItemId = (items: TodoItem[]) => {
  let index = items.length + 1
  while (items.some((item) => item.id === `t${index}`)) {
    index += 1
  }
  return `t${index}`
}

export default function TodoStateScreen() {
  const router = useRouter()
  const isAndroid = Platform.OS === 'android'

  // --- Items --------------------------------------------------------------------------------------

  const [items, setItems] = useState<TodoItem[]>(INITIAL_ITEMS)
  const [pushStatus, setPushStatus] = useState<string | null>(null)

  const updateTitle = (id: string, title: string) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, title } : item)))

  const removeItem = (id: string) => setItems((current) => current.filter((item) => item.id !== id))

  const moveItem = (index: number, offset: -1 | 1) =>
    setItems((current) => {
      const target = index + offset
      if (target < 0 || target >= current.length) {
        return current
      }
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })

  const addItem = () => setItems((current) => [...current, { id: nextItemId(current), title: 'New task' }])

  const pushItems = async (widgetId: TodoWidgetId) => {
    try {
      await updateAndroidDynamicWidget(widgetId, { items: items.map(({ id, title }) => ({ id, title })) })
      setPushStatus(`Pushed ${items.length} items to ${widgetId}.`)
    } catch (error) {
      setPushStatus(`Push to ${widgetId} failed: ${errorMessage(error)}`)
    }
  }

  // --- Pin ----------------------------------------------------------------------------------------

  const pinWidget = async (widgetId: TodoWidgetId) => {
    try {
      const requested = await requestPinAndroidWidget(widgetId, { previewWidth: 255, previewHeight: 200 })
      if (!requested) {
        Alert.alert('Not supported', 'This launcher does not accept pin requests.')
      }
    } catch (error) {
      Alert.alert('Error', `Failed to request widget pin: ${errorMessage(error)}`)
    }
  }

  // --- Placements ---------------------------------------------------------------------------------

  const [placements, setPlacements] = useState<Placement[]>([])
  const [placementsError, setPlacementsError] = useState<string | null>(null)

  const refreshPlacements = useCallback(async () => {
    if (!isAndroid) {
      return
    }
    try {
      const widgets = (await getActiveWidgets()).filter(isTodoWidget)
      const next = await Promise.all(
        widgets.map(async (widget): Promise<Placement> => {
          try {
            return { widget, snapshot: await readAndroidDynamicWidgetState(widget.appWidgetId), error: null }
          } catch (error) {
            return { widget, snapshot: null, error: errorMessage(error) }
          }
        })
      )
      setPlacements(next)
      setPlacementsError(null)
    } catch (error) {
      setPlacementsError(errorMessage(error))
    }
  }, [isAndroid])

  const resetPlacement = async (appWidgetId: number) => {
    try {
      await resetAndroidDynamicWidgetState(appWidgetId)
    } catch (error) {
      Alert.alert('Error', `Failed to reset state: ${errorMessage(error)}`)
    }
    await refreshPlacements()
  }

  // --- Events -------------------------------------------------------------------------------------

  // Draining removes the events natively, so the screen keeps what it has drained, newest first.
  const [events, setEvents] = useState<AndroidDynamicWidgetInteractionEvent[]>([])
  const [eventsError, setEventsError] = useState<string | null>(null)
  const isDrainingRef = useRef(false)

  const drainEvents = useCallback(async () => {
    if (!isAndroid || isDrainingRef.current) {
      return
    }
    isDrainingRef.current = true
    try {
      const drained = await drainAndroidDynamicWidgetEvents()
      if (drained.length > 0) {
        setEvents((current) => [...[...drained].reverse(), ...current])
      }
      setEventsError(null)
    } catch (error) {
      setEventsError(errorMessage(error))
    } finally {
      isDrainingRef.current = false
    }
  }, [isAndroid])

  useEffect(() => {
    drainEvents()
    refreshPlacements()
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        drainEvents()
        refreshPlacements()
      }
    })
    return () => subscription.remove()
  }, [drainEvents, refreshPlacements])

  // --- Flags --------------------------------------------------------------------------------------

  // The PoC has no getter for the flags, so these show what this screen last saved, starting from
  // the defaults.
  const [scope, setScope] = useState<Scope>('placement')
  const [precedence, setPrecedence] = useState<Precedence>('survive')
  const [interactDelayMs, setInteractDelayMs] = useState('0')
  const [flagsStatus, setFlagsStatus] = useState<string | null>(null)

  const saveFlags = async () => {
    const delay = Number(interactDelayMs)
    if (interactDelayMs.trim() === '' || !Number.isInteger(delay) || delay < 0) {
      setFlagsStatus('interactDelayMs must be a whole number of zero or greater.')
      return
    }
    const flags: AndroidDynamicWidgetStateFlags = { scope, precedence, interactDelayMs: delay }
    try {
      await setAndroidDynamicWidgetStateFlags(flags)
      setFlagsStatus(`Saved ${JSON.stringify(flags)}. Every Dynamic Widget re-renders.`)
    } catch (error) {
      setFlagsStatus(`Saving flags failed: ${errorMessage(error)}`)
    }
    await refreshPlacements()
  }

  const restoreDefaultFlags = async () => {
    try {
      await setAndroidDynamicWidgetStateFlags({ scope: null, precedence: null, interactDelayMs: null })
      setScope('placement')
      setPrecedence('survive')
      setInteractDelayMs('0')
      setFlagsStatus('Restored the defaults. Every Dynamic Widget re-renders.')
    } catch (error) {
      setFlagsStatus(`Restoring defaults failed: ${errorMessage(error)}`)
    }
    await refreshPlacements()
  }

  return (
    <ScreenLayout
      title="In-widget state (PoC #343)"
      description="Two Dynamic Widgets whose taps change their own state without the app: one through an onInteraction handler, one through the stateKey prop. Throwaway PoC, not API."
    >
      <Card>
        <Card.Title>Items</Card.Title>
        <Card.Text>Edited here, then pushed as the widget props. A push never touches the state record.</Card.Text>

        {items.map((item, index) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={styles.itemId}>{item.id}</Text>
            <TextInput
              accessibilityLabel={`Title of ${item.id}`}
              style={[styles.input, styles.itemInput]}
              value={item.title}
              onChangeText={(title) => updateTitle(item.id, title)}
              maxLength={40}
              placeholderTextColor="#64748B"
            />
            <View style={styles.itemActions}>
              <Button
                title="↑"
                variant="ghost"
                style={styles.smallButton}
                disabled={index === 0}
                onPress={() => moveItem(index, -1)}
              />
              <Button
                title="↓"
                variant="ghost"
                style={styles.smallButton}
                disabled={index === items.length - 1}
                onPress={() => moveItem(index, 1)}
              />
              <Button title="✕" variant="ghost" style={styles.smallButton} onPress={() => removeItem(item.id)} />
            </View>
          </View>
        ))}

        <View style={styles.buttonColumn}>
          <Button title="Add item" variant="secondary" onPress={addItem} />
          {TODO_WIDGET_IDS.map((widgetId) => (
            <Button key={widgetId} title={`Push to ${widgetId}`} onPress={() => pushItems(widgetId)} />
          ))}
        </View>
        {pushStatus ? <Text style={styles.status}>{pushStatus}</Text> : null}
      </Card>

      <Card>
        <Card.Title>Pin</Card.Title>
        <Card.Text>Shows the system &quot;Add widget&quot; dialog for one of the two widgets.</Card.Text>
        <View style={styles.buttonColumn}>
          {TODO_WIDGET_IDS.map((widgetId) => (
            <Button
              key={widgetId}
              title={`Pin ${WIDGET_LABELS[widgetId]}`}
              variant="secondary"
              onPress={() => pinWidget(widgetId)}
            />
          ))}
        </View>
      </Card>

      <Card>
        <Card.Title>Placements</Card.Title>
        <Card.Text>Each placed copy has its own state record (in placement scope).</Card.Text>
        <View style={styles.buttonColumn}>
          <Button title="Refresh" variant="secondary" onPress={refreshPlacements} />
        </View>
        {placementsError ? <Text style={styles.error}>{placementsError}</Text> : null}
        {placements.length === 0 ? (
          <Text style={styles.status}>No Todo widget is placed.</Text>
        ) : (
          placements.map(({ widget, snapshot, error }) => (
            <View key={widget.appWidgetId} style={styles.placement}>
              <Text style={styles.placementTitle}>
                {widget.widgetType} · appWidgetId {widget.appWidgetId}
              </Text>
              {error ? (
                <Text style={styles.error}>{error}</Text>
              ) : (
                <>
                  <Text style={styles.mono}>stateRevision {snapshot?.stateRevision ?? '-'}</Text>
                  <Text style={styles.mono}>{JSON.stringify(snapshot?.state ?? null, null, 2)}</Text>
                </>
              )}
              <Button
                title="Reset state"
                variant="ghost"
                style={styles.inlineButton}
                onPress={() => resetPlacement(widget.appWidgetId)}
              />
            </View>
          ))
        )}
      </Card>

      <Card>
        <Card.Title>Events</Card.Title>
        <Card.Text>
          Taps the widgets handled while the app was not involved. Drained on open, when the app comes back to the
          foreground, and on demand; newest first.
        </Card.Text>
        <View style={styles.buttonColumn}>
          <Button title="Drain events" variant="secondary" onPress={drainEvents} />
          <Button title="Clear list" variant="ghost" onPress={() => setEvents([])} />
        </View>
        {eventsError ? <Text style={styles.error}>{eventsError}</Text> : null}
        {events.length === 0 ? (
          <Text style={styles.status}>No events drained yet.</Text>
        ) : (
          events.map((event) => (
            <View key={event.eventId} style={styles.event}>
              <Text style={styles.placementTitle}>
                #{event.seq} {event.widgetId} · {event.identifier}
              </Text>
              <Text style={styles.mono}>
                checked {String(event.checked)} · handledInWidget {String(event.handledInWidget)} · stateRevision{' '}
                {event.stateRevision} (rendered {event.renderedRevision})
              </Text>
              <Text style={styles.mono}>stateChange {JSON.stringify(event.stateChange)}</Text>
            </View>
          ))
        )}
      </Card>

      <Card>
        <Card.Title>Flags</Card.Title>
        <Card.Text>PoC switches. The selection shows what this screen last saved; there is no getter.</Card.Text>

        <Text style={styles.label}>Scope</Text>
        <View style={styles.segment}>
          {(['placement', 'widgetScope'] as const).map((value) => (
            <Button
              key={value}
              title={value}
              variant={scope === value ? 'primary' : 'ghost'}
              style={styles.segmentButton}
              onPress={() => setScope(value)}
            />
          ))}
        </View>

        <Text style={styles.label}>Precedence on a props push</Text>
        <View style={styles.segment}>
          {(['survive', 'resetOnPush'] as const).map((value) => (
            <Button
              key={value}
              title={value}
              variant={precedence === value ? 'primary' : 'ghost'}
              style={styles.segmentButton}
              onPress={() => setPrecedence(value)}
            />
          ))}
        </View>

        <Text style={styles.label}>interactDelayMs</Text>
        <TextInput
          accessibilityLabel="Artificial delay before a tap commits, in milliseconds"
          style={styles.input}
          value={interactDelayMs}
          onChangeText={setInteractDelayMs}
          keyboardType="numeric"
          maxLength={6}
          placeholder="0"
          placeholderTextColor="#64748B"
        />

        <View style={styles.buttonColumn}>
          <Button title="Save flags" onPress={saveFlags} />
          <Button title="Restore defaults" variant="ghost" onPress={restoreDefaultFlags} />
        </View>
        {flagsStatus ? <Text style={styles.status}>{flagsStatus}</Text> : null}
      </Card>

      <View style={styles.footer}>
        <Button title="Back to Android Widgets" variant="ghost" onPress={() => router.back()} />
      </View>
    </ScreenLayout>
  )
}

const styles = StyleSheet.create({
  itemRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemId: {
    width: 28,
    color: '#94A3B8',
    fontSize: 12,
  },
  itemInput: {
    flex: 1,
  },
  itemActions: {
    flexDirection: 'row',
    gap: 4,
  },
  smallButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
    borderRadius: 12,
    backgroundColor: '#1E293B',
    color: '#E2E8F0',
    fontSize: 15,
  },
  label: {
    marginTop: 16,
    marginBottom: 8,
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonColumn: {
    marginTop: 16,
    gap: 10,
  },
  segment: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentButton: {
    flex: 1,
    paddingHorizontal: 12,
  },
  inlineButton: {
    marginTop: 10,
  },
  placement: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#1E293B',
  },
  event: {
    marginTop: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.15)',
  },
  placementTitle: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  mono: {
    marginTop: 4,
    color: '#CBD5E1',
    fontSize: 12,
    fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' }),
  },
  status: {
    marginTop: 12,
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  error: {
    marginTop: 12,
    color: '#FCA5A5',
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    marginTop: 24,
    alignItems: 'center',
  },
})
