import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {useStationRefresh} from './useStationRefresh';
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('station presentation refresh',()=>{
  it('fetches remote changes, pauses while a command is busy, and stops after exit',async()=>{
    vi.useFakeTimers();const refresh=vi.fn().mockResolvedValue(undefined);
    const hook=renderHook(({enabled})=>useStationRefresh(refresh,enabled),{initialProps:{enabled:true}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(refresh).toHaveBeenCalledTimes(1);
    hook.rerender({enabled:false});await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});expect(refresh).toHaveBeenCalledTimes(1);
    hook.rerender({enabled:true});await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(refresh).toHaveBeenCalledTimes(2);
    hook.unmount();await vi.advanceTimersByTimeAsync(6000);expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('does not overlap slow refreshes and reports failures',async()=>{
    vi.useFakeTimers();let reject:(reason?:unknown)=>void;
    const refresh=vi.fn(()=>new Promise<void>((_,no)=>{reject=no;}));
    const hook=renderHook(()=>useStationRefresh(refresh,true));
    await act(async()=>{await vi.advanceTimersByTimeAsync(8000);});expect(refresh).toHaveBeenCalledTimes(1);
    await act(async()=>{reject(new Error('device disconnected'));await Promise.resolve();});expect(hook.result.current).toBe(true);
  });
});
