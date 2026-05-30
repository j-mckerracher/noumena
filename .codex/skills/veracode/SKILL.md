---
name: veracode
version: 1.0.0
description: >
  Veracode-style static application security testing (SAST) analysis for code review.
  Covers OWASP Top 10, CWE categories, secure coding patterns, and vulnerability detection
  across C#/.NET, JavaScript/TypeScript, Python, and Java. Use when reviewing code for
  security vulnerabilities, performing SAST-like analysis, or hardening applications against
  common attack vectors.
  Keywords: veracode, SAST, static analysis, security scan, OWASP, CWE, vulnerability,
  secure coding, injection, XSS, CSRF, auth, encryption, secrets, hardcoded credentials,
  insecure deserialization, path traversal, XXE, SSRF, misconfiguration.
---

## Dynamic context

No default `!` pre-execution injection is recommended for this skill. It is a reference and patterns guide. Inject live state only when targeting a specific codebase scan.

# Veracode Security Analysis

## When to Use This Skill

Activate this skill when:

- Reviewing code for security vulnerabilities (SAST analysis)
- Analyzing a PR or changeset for security risks
- Performing a security audit of new or modified code
- Validating that code follows secure coding standards
- Checking for OWASP Top 10 or CWE Top 25 vulnerabilities
- The user asks for a "Veracode scan" or "security review" of code

## Analysis Approach

Veracode-style SAST analysis examines code statically (without execution) to identify potential security flaws. For each file under review, apply the following methodology:

### 1. Data Flow Analysis

Trace untrusted data from entry points (user input, API requests, file reads, database queries, message queues) through the application to sensitive sinks (database queries, command execution, file writes, response output, deserialization).

**Key principle**: Any data originating from outside the trust boundary must be validated, sanitized, or encoded before reaching a sensitive sink.

### 2. Control Flow Analysis

Identify dangerous code paths that could be exploited:
- Unvalidated redirects and forwards
- Missing authorization checks on sensitive operations
- Race conditions in security-critical sections
- Exception handlers that leak sensitive information

### 3. Configuration Analysis

Review configuration files for security misconfigurations:
- Debug mode enabled in production
- Verbose error messages exposing stack traces
- Missing security headers
- Insecure default settings
- Overly permissive CORS policies

## Vulnerability Categories

### 🔴 CRITICAL — OWASP Top 10

#### A1: Injection (SQL, Command, LDAP, etc.)

**C# / .NET patterns to flag:**

```csharp
// DANGEROUS: String concatenation in SQL
var query = "SELECT * FROM Users WHERE Name = '" + userName + "'";  // SQL Injection

// DANGEROUS: Raw command execution
Process.Start("cmd.exe", "/c " + userInput);  // Command Injection

// SAFE: Parameterized queries
var query = "SELECT * FROM Users WHERE Name = @Name";
cmd.Parameters.AddWithValue("@Name", userName);

// SAFE: Entity Framework / LINQ
var user = db.Users.Where(u => u.Name == userName).FirstOrDefault();
```

**JavaScript / TypeScript patterns to flag:**

```javascript
// DANGEROUS
const query = `SELECT * FROM users WHERE name = '${userName}'`;
exec(`rm -rf ${userInput}`);

// SAFE
const query = 'SELECT * FROM users WHERE name = ?';
db.query(query, [userName]);
```

#### A2: Broken Authentication

Flags:
- Hardcoded credentials or tokens
- Weak password policies
- Session tokens in URLs
- Missing multi-factor authentication on sensitive endpoints
- Credentials in config files without encryption
- JWT tokens without expiration or signature verification

#### A3: Sensitive Data Exposure

Flags:
- Plaintext passwords, API keys, or connection strings in code or config
- Missing encryption for data at rest
- Unencrypted transmission of sensitive data (HTTP instead of HTTPS)
- Sensitive data in logs or error messages
- Insecure cryptographic algorithms (MD5, SHA1, DES, RC4)

**C# patterns to flag:**

```csharp
// DANGEROUS: Weak hashing
MD5.Create().ComputeHash(data);
SHA1.Create().ComputeHash(data);

// DANGEROUS: Hardcoded secrets
string apiKey = "sk-abc123def456";
string connStr = "Server=prod;User=admin;Password=secret123;";

// SAFE: Strong hashing with salt
using var pbkdf2 = new Rfc2898DeriveBytes(password, salt, 100000, HashAlgorithmName.SHA256);

// SAFE: Secrets from secure configuration
string apiKey = Configuration["ApiKey"];  // From Azure Key Vault / env var
```

#### A4: XML External Entities (XXE)

**C# patterns to flag:**

```csharp
// DANGEROUS: Default XML reader (XXE vulnerable)
var reader = XmlReader.Create(inputStream);

// SAFE: Disable DTD processing
var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit };
var reader = XmlReader.Create(inputStream, settings);
```

#### A5: Broken Access Control

Flags:
- Missing `[Authorize]` attributes on sensitive controller actions
- Direct object references without ownership checks
- CORS allowing any origin (`Access-Control-Allow-Origin: *` with credentials)
- Privilege escalation via parameter manipulation
- API endpoints that don't verify resource ownership

**C# patterns to flag:**

```csharp
// DANGEROUS: No authorization check
[HttpGet("users/{id}")]
public IActionResult GetUser(int id) { ... }

// SAFE: Authorization check
[HttpGet("users/{id}")]
[Authorize]
public IActionResult GetUser(int id)
{
    if (User.FindFirst("userId")?.Value != id.ToString())
        return Forbid();
    ...
}
```

#### A6: Security Misconfiguration

Flags:
- Debug/development settings in production (`appsettings.json` with debug=true)
- Verbose error pages with stack traces
- Default credentials or admin pages accessible
- Missing security headers (HSTS, X-Frame-Options, X-Content-Type-Options, CSP)
- Unnecessary features enabled (unused endpoints, debug endpoints, directory listing)

#### A7: Cross-Site Scripting (XSS)

**C# / Razor patterns:**

```csharp
// DANGEROUS: Raw HTML output
@Html.Raw(userInput)

// SAFE: Auto-encoded in Razor (default)
@userInput  // Automatically HTML-encoded

// SAFE: Explicit encoding
@Html.Encode(userInput)
```

#### A8: Insecure Deserialization

**C# patterns to flag:**

```csharp
// DANGEROUS: Untrusted type deserialization
var serializer = new BinaryFormatter();
var obj = serializer.Deserialize(untrustedStream);

var serializer = new JavaScriptSerializer();
var obj = serializer.Deserialize<object>(untrustedJson);

// SAFE: Use type-safe serializers with type checking
var opts = new JsonSerializerOptions { ... };
var obj = JsonSerializer.Deserialize<ExpectedType>(json, opts);
```

#### A9: Using Components with Known Vulnerabilities

Flags:
- Outdated NuGet packages with known CVEs
- Unpatched framework versions
- Packages from untrusted sources
- Transitive dependencies pulling vulnerable versions

#### A10: Insufficient Logging & Monitoring

Flags:
- No logging of authentication attempts (success/failure)
- No logging of sensitive operations (data modification, permission changes)
- Logs missing correlation IDs for tracing
- Logs containing sensitive data (passwords, tokens, PII)

### 🟡 ADDITIONAL CWE CHECKS

#### Path Traversal (CWE-22)

```csharp
// DANGEROUS
File.ReadAllText(userProvidedPath);
File.Delete("../" + fileName);

// SAFE
var safePath = Path.GetFullPath(Path.Combine(basePath, fileName));
if (!safePath.StartsWith(basePath)) throw new SecurityException();
```

#### Server-Side Request Forgery / SSRF (CWE-918)

```csharp
// DANGEROUS: User-controlled URL
var client = new HttpClient();
var response = await client.GetAsync(userProvidedUrl);

// SAFE: URL validation and allowlisting
if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
    !allowedDomains.Contains(uri.Host))
    throw new SecurityException();
```

#### Open Redirect (CWE-601)

```csharp
// DANGEROUS
return Redirect(userProvidedUrl);

// SAFE
if (!Url.IsLocalUrl(returnUrl))
    return RedirectToAction("Index", "Home");
return Redirect(returnUrl);
```

#### Uncontrolled Format String (CWE-134)

```csharp
// DANGEROUS
Console.WriteLine(userInput);  // If userInput contains format specifiers
string.Format(userInput, args);

// SAFE
Console.WriteLine("{0}", userInput);
```

## .NET / C# Specific Checks

### Controller Security

For each ASP.NET controller action, verify:

1. `[Authorize]` attribute is present on actions requiring authentication
2. Role-based checks use `[Authorize(Roles = "...")]` correctly
3. Anti-forgery tokens are validated for state-changing operations (`[ValidateAntiForgeryToken]`)
4. Model validation is performed: `if (!ModelState.IsValid) return BadRequest(ModelState);`
5. Mass assignment protection: use view models / DTOs, not entity binding

### Dependency Injection & Service Security

- Scoped services aren't captured by singletons (captive dependency)
- `HttpClient` uses `IHttpClientFactory` (not `new HttpClient()`)
- Database connections are properly disposed

### Error Handling

```csharp
// DANGEROUS: Exposing internal details
catch (Exception ex) { return Content(ex.ToString()); }

// SAFE: Generic error, log details server-side
catch (Exception ex) {
    _logger.LogError(ex, "Operation failed for user {UserId}", userId);
    return StatusCode(500, "An unexpected error occurred.");
}
```

## Review Workflow

When performing a Veracode-style security review:

1. **Inventory entry points**: Controllers, API endpoints, message handlers, file upload endpoints
2. **Trace data flows**: For each entry point, trace how data moves through the application
3. **Identify sinks**: Database queries, command execution, file operations, HTTP responses, deserialization
4. **Check validation at boundaries**: Is all input validated before reaching sensitive operations?
5. **Review authentication & authorization**: Every sensitive endpoint, every data access
6. **Check configuration**: App settings, security headers, framework defaults
7. **Audit dependencies**: NuGet packages, framework version, transitive dependencies

## Severity Mapping to PR Review

| Veracode Severity | PR Review Severity | Action Required                     |
| ----------------- | ------------------ | ----------------------------------- |
| Very High (5)     | 🔴 CRITICAL        | Must fix before merge               |
| High (4)          | 🔴 CRITICAL        | Must fix before merge               |
| Medium (3)        | 🟡 WARNING         | Should fix, rationale if deferred   |
| Low (2)           | 🔵 NOTE            | Consider fixing in follow-up        |
| Informational (1) | 🔵 NOTE            | Awareness only                      |

## Code-Specific Review Focus

When the user specifies a code path or project to review, focus the security analysis on:

- All `.cs` files (for .NET projects)
- `appsettings.json` / `appsettings.*.json` / `web.config` (configuration)
- `.csproj` files (package references and versions)
- `Program.cs` / `Startup.cs` (middleware, service registration, security setup)
- `Controllers/` (all API surface area)

Do NOT flag issues in generated code, migration files, or build artifacts.
