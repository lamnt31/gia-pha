// Cấu hình web của project Firebase "gia-pha-lamnt" (công khai theo thiết kế; dữ liệu được bảo vệ bằng firestore.rules)
export const firebaseConfig = {
  apiKey: 'AIzaSyDojtugk4p0XJl5i2bbe1qJ6qZ5y8e6SE0',
  authDomain: 'gia-pha-lamnt.firebaseapp.com',
  projectId: 'gia-pha-lamnt',
  storageBucket: 'gia-pha-lamnt.firebasestorage.app',
  messagingSenderId: '573840393133',
  appId: '1:573840393133:web:2a99fc83700a00ab221724',
};
// Site key reCAPTCHA v3 cho App Check (README bước 6). Để trống = chưa bật.
export const recaptchaSiteKey = '';
// Khóa công khai Web Push (VAPID) cho thông báo giỗ / sinh nhật. Khóa bí mật chỉ nằm trong Secrets của repo gia-pha-cron.
// (đổi khóa 19/10/2026 – app tự đăng ký lại cho máy đã bật thông báo)
export const vapidPublicKey = 'BESAMFoQTOh8T3KE2vOX_Z60VLzul7O6x43FD84G6nbyo2az8sD8jNXShf7c98cqY-KrUygEnW7N-CrmWHcIYVg';
// Trạm gửi thông báo tức thì (Cloudflare Worker – docs/SETUP-worker.md): báo tang, báo hỷ, tin nhắn. Để trống = chưa cài (tin vẫn đăng, chỉ chưa đẩy).
export const workerUrl = 'https://gia-pha-push.giapha-lamnt.workers.dev';
