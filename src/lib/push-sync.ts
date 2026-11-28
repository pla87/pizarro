"use client";

import { pushSetup, renewPush } from "@/actions/push";
import { makeResync } from "./push-sync-core";

/** Resincronización en silencio de los avisos push de este dispositivo (la lógica y su explicación, en push-sync-core). */
export const resyncPush = makeResync({ pushSetup, renewPush });
