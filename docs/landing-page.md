# Landing Page and Login Entry

Detail for `PRD.md` §4.1 and §5.1. If this file and `PRD.md` disagree, `PRD.md` wins. The landing page is separate from the dashboards (see `dashboards.md`) because it is public and shown before anyone logs in.

## 1. Purpose
Everyone can open the site without an account. It is the college's public front door. From here, a student, teacher or the Admin goes into the portal by logging in.

## 2. Public sections (no login needed)
- **Header:** college logo and name; **Login** button (top-right).
- **Hero:** college banner and a short introduction.
- **About** the college.
- **Departments** (groups).
- **Latest public notices:** Central Notices the Admin marked "Show on public landing page" (§5.9). Attachments are public files.
- **Book Shop preview:** a few book covers and titles. Buying needs a student login.
- **Contact:** address, phone, email.
- **Footer.**

Nothing private is shown: no student data, no feed posts, no exam or class content.

## 3. Role buttons and login (client choice: role buttons, one form)
Below the hero (and behind the top-right Login button) the page shows three buttons:

| Button | Who | What happens |
|---|---|---|
| **Student Login** | Students | Opens the login form with "Student" pre-selected |
| **Teacher Login** | Teachers and Section Mentors | Opens the same form with "Teacher" pre-selected |
| **Admin Login** | The Admin | Opens the same form with "Admin" pre-selected |

The top-right **Login** button opens the same form with no role pre-selected.

Rules:
1. It is **one login form** for everyone: **User ID or Email** + **Password**.
2. The pre-selected role is only a convenience (label and wording). **The server decides the role from the account**, never from the button. If someone uses the wrong button, they still land on the dashboard of their real role, or get a clear message "This is a Teacher account" and are sent to the right login. Never show which accounts exist (same generic error for a wrong ID or password).
3. **Admin** also enters a one-time code from the authenticator app (or a backup code) after the password (§4.6).
4. **First login** for a Teacher or Student: forced "Complete Your Profile" step (new password + mobile) before the dashboard (§4.2).
5. After success, the person goes to their **role dashboard** (Admin, Teacher / Section Mentor, Student; see `dashboards.md`).
6. Already logged in: opening the landing page shows an **Open my dashboard** button instead of the login buttons.
7. Forgot password: link on the form (email reset works only for a verified email; otherwise the Admin resets it, §4.3).
8. Login is rate-limited; no self-registration (the Admin creates every account).

## 4. Flow
```
Anyone opens the site
        │
        ▼
   Landing page (public)
        │  Student / Teacher / Admin Login
        ▼
   Login form (ID or email + password; Admin + code)
        │
        ├─ first login ──> Complete Your Profile ──┐
        ▼                                          ▼
   Role dashboard (Admin | Teacher/Mentor | Student)
```

## 5. Phone layout (phone-first, 360 px)
- Single column; hero image resized and lazy-loaded.
- Three large role buttons (at least 44 px tall) stacked under the hero; Login stays reachable in the header.
- Notices as stacked cards; Book Shop preview as a horizontal swipe row.
- Login form is one column, 16 px inputs, correct keyboard types, show/hide password.
- Light page: no heavy libraries on the landing page; the page works on slow mobile data and can be added to the home screen (PWA).
