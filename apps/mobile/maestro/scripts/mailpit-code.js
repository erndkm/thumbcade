// Reads the newest 6-digit code sent to EMAIL from Mailpit (local Supabase inbox).
var res = http.get("http://127.0.0.1:54324/api/v1/search?query=" + encodeURIComponent("to:" + EMAIL) + "&limit=1");
var msgs = json(res.body).messages || [];
if (msgs.length === 0) throw new Error("no mail for " + EMAIL);
var msg = json(http.get("http://127.0.0.1:54324/api/v1/message/" + msgs[0].ID).body);
var m = /\b(\d{6})\b/.exec(msg.Subject + " " + msg.Text);
if (!m) throw new Error("no code in mail");
output.otp = m[1];
