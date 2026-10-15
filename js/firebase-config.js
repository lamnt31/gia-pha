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
export const vapidPublicKey = 'BJ_1RRY3ga8XhzXxiVmPiFAwehnF5UvSDr-sRcYuOgpDr8CUmekxbTGOmziVfwGDU8ckiAQ5HXhgCtyUQPpzkU0';
