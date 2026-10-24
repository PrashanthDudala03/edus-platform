# School-wide branding

School Home > Hero contains primary/accent controls. Save draft applies colours to the signed-in school workspace immediately, without publishing draft content. Other active sessions refresh their school palette within 15 seconds or on focus. Published School Home uses the same saved palette. Reset with Use EduOS colours, then Save draft.

The authenticated GET /api/v1/suite/branding returns only the caller schoolId and saved brand. Existing school-home.manage permission protects editing. Query keys include schoolId; palette variables stay on the shell DOM node and disappear when it unmounts. Platform screens and unknown-school sign-in remain neutral. Error/warning/status meanings remain unchanged.

Load sample photos replaces sample visual sections in the editor only after confirmation. It uploads five local assets into the existing tenant-protected image store. Save/preview persists the draft; Publish is a separate action. The demo school now has the sample draft. Existing school colours restored after tests. Photos/portraits are illustrative, not real staff portraits.

Validation: 12 colour/helper tests, 117 shared permission tests, 16 School Home browser scenarios including accessibility at five widths, live two-school isolation/edit restriction test, and real save/reload/teacher-sharing/sample-image checks passed. Local frontend test builds must set VITE_API_URL=/api/v1; the ignored frontend/.env.local points at port 8080. Docker already uses /api/v1.

Sample photo sources (downloaded locally, no remote browser image requests):

- Banner: https://images.unsplash.com/photo-1580582932707-520aed937b7b

- Principal sample: https://images.unsplash.com/photo-1500648767791-00dcc994a43e

- Faculty sample: https://images.unsplash.com/photo-1580489944761-15a19d654956

- Achievement/gallery: https://images.unsplash.com/photo-1503676260728-1c00da094a0b

- Logo: project-generated E monogram. Replace sample portraits and content before publishing as a real school profile.
