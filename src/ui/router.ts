import { useEffect, useState } from 'preact/hooks';
import { sfx } from '../audio/sfx';

export interface Route { name: string; params: Record<string, any> }
let stack: Route[] = [{ name: 'title', params: {} }];
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export const route = (): Route => stack[stack.length - 1];
export function nav(name: string, params: Record<string, any> = {}): void { sfx.click(); stack.push({ name, params }); emit(); }
export function replace(name: string, params: Record<string, any> = {}): void { stack[stack.length - 1] = { name, params }; emit(); }
/** Clear history and go to a root screen. */
export function reset(name: string, params: Record<string, any> = {}): void { stack = [{ name, params }]; emit(); }
export function back(): void { sfx.click(); if (stack.length > 1) stack.pop(); emit(); }
export function useRoute(): Route {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set(v => v + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return route();
}
