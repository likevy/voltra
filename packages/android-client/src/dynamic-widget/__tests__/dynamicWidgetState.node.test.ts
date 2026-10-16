import { getNativeVoltraAndroid, type Spec } from '../../native/NativeVoltraAndroid.js'

import {
  drainAndroidDynamicWidgetEvents,
  readAndroidDynamicWidgetState,
  resetAndroidDynamicWidgetState,
  setAndroidDynamicWidgetStateFlags,
} from '../api.js'

jest.mock('../../native/NativeVoltraAndroid.js', () => ({
  getNativeVoltraAndroid: jest.fn(),
}))

const mockedGetNativeVoltraAndroid = jest.mocked(getNativeVoltraAndroid)

// PoC for issue #343: the JS side of the in-widget state module methods only (de)serialises.
describe('Dynamic Widget state (PoC #343)', () => {
  it('parses the state snapshot of one placement', async () => {
    const readDynamicWidgetState = jest.fn<Promise<string>, [number]>()
    readDynamicWidgetState.mockResolvedValue('{"state":{"done.t1":true},"stateRevision":3}')
    mockedGetNativeVoltraAndroid.mockReturnValue({ readDynamicWidgetState } as unknown as Spec)

    await expect(readAndroidDynamicWidgetState(7)).resolves.toEqual({
      state: { 'done.t1': true },
      stateRevision: 3,
    })
    expect(readDynamicWidgetState).toHaveBeenCalledWith(7)
  })

  it('forwards a reset for one placement', async () => {
    const resetDynamicWidgetState = jest.fn<Promise<void>, [number]>()
    resetDynamicWidgetState.mockResolvedValue(undefined)
    mockedGetNativeVoltraAndroid.mockReturnValue({ resetDynamicWidgetState } as unknown as Spec)

    await resetAndroidDynamicWidgetState(4)

    expect(resetDynamicWidgetState).toHaveBeenCalledWith(4)
  })

  it('parses drained events in queue order', async () => {
    const events = [
      { type: 'interaction', identifier: 't1', seq: 1, handledInWidget: true },
      { type: 'interaction', identifier: 't2', seq: 2, handledInWidget: false },
    ]
    const drainDynamicWidgetEvents = jest.fn<Promise<string>, []>()
    drainDynamicWidgetEvents.mockResolvedValue(JSON.stringify(events))
    mockedGetNativeVoltraAndroid.mockReturnValue({ drainDynamicWidgetEvents } as unknown as Spec)

    await expect(drainAndroidDynamicWidgetEvents()).resolves.toEqual(events)
  })

  it('serialises flags, keeping null as "back to the default"', async () => {
    const setDynamicWidgetStateFlags = jest.fn<Promise<void>, [string]>()
    setDynamicWidgetStateFlags.mockResolvedValue(undefined)
    mockedGetNativeVoltraAndroid.mockReturnValue({ setDynamicWidgetStateFlags } as unknown as Spec)

    await setAndroidDynamicWidgetStateFlags({ scope: 'widgetScope', interactDelayMs: 250, precedence: null })

    expect(setDynamicWidgetStateFlags).toHaveBeenCalledWith(
      '{"scope":"widgetScope","interactDelayMs":250,"precedence":null}'
    )
  })
})
