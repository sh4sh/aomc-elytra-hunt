// The one map on the page.

import { $ } from './dom';
import { EndMap } from './map';

export const map = new EndMap($<HTMLCanvasElement>('map'));
