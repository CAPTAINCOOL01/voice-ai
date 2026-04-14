const passport       = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const GitHubStrategy = require("passport-github2").Strategy;

// User model is passed in to avoid circular deps
module.exports = function initPassport(User) {

  // ── Serialize / Deserialize (needed for session) ─────────
  passport.serializeUser((user, done) => done(null, user._id));
  passport.deserializeUser(async (id, done) => {
    try { done(null, await User.findById(id)); }
    catch (e) { done(e); }
  });

  // ── Google ────────────────────────────────────────────────
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy(
      {
        clientID:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:  `${process.env.APP_URL || ""}/auth/google/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value || "";
          let user = await User.findOne({ provider: "google", providerId: profile.id });
          if (!user && email) user = await User.findOne({ email, provider: "local" });
          if (!user) {
            user = await User.create({
              username:   email || `google_${profile.id}`,
              name:       profile.displayName || "",
              email,
              provider:   "google",
              providerId: profile.id,
              avatar:     profile.photos?.[0]?.value || "",
              passwordHash: null,
            });
          }
          done(null, user);
        } catch (e) { done(e); }
      }
    ));
  }

  // ── GitHub ────────────────────────────────────────────────
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport.use(new GitHubStrategy(
      {
        clientID:     process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL:  `${process.env.APP_URL || ""}/auth/github/callback`,
        scope:        ["user:email"],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value || "";
          let user = await User.findOne({ provider: "github", providerId: String(profile.id) });
          if (!user && email) user = await User.findOne({ email, provider: "local" });
          if (!user) {
            user = await User.create({
              username:   profile.username || `github_${profile.id}`,
              name:       profile.displayName || profile.username || "",
              email,
              provider:   "github",
              providerId: String(profile.id),
              avatar:     profile.photos?.[0]?.value || "",
              passwordHash: null,
            });
          }
          done(null, user);
        } catch (e) { done(e); }
      }
    ));
  }

  return passport;
};
