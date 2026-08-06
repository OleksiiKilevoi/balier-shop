// The Workers runtime types the lib references (media, rateLimit, notify).
// Pulled from workers-types' importable subpath instead of its global ambient
// package: the package contains client-side modules (admin/forms, cart/store,
// cartPopup, phone) that need the DOM lib, and the ambient workers-types
// redeclare fetch/Request/Response and collide with it. Inside the apps these
// same globals come from each app's generated worker-configuration.d.ts.
import type {
  EmailMessageBuilder as WorkersEmailMessageBuilder,
  ImagesBinding as WorkersImagesBinding,
  KVNamespace as WorkersKVNamespace,
  R2Bucket as WorkersR2Bucket,
  R2Object as WorkersR2Object,
  SendEmail as WorkersSendEmail,
} from '@cloudflare/workers-types/experimental';

declare global {
  type EmailMessageBuilder = WorkersEmailMessageBuilder;
  type ImagesBinding = WorkersImagesBinding;
  type KVNamespace<Key extends string = string> = WorkersKVNamespace<Key>;
  type R2Bucket = WorkersR2Bucket;
  type R2Object = WorkersR2Object;
  type SendEmail = WorkersSendEmail;
}

export {};
