// Works out batches off the main thread, so large ones don't freeze the page.
import { makeBatchesOrSmaller, type BatchJob } from './filters';

addEventListener('message', (e: MessageEvent<BatchJob>) => {
  postMessage(makeBatchesOrSmaller(e.data));
});
