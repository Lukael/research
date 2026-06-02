(function () {
  var form = document.getElementById("unlock-form");
  var passwordInput = document.getElementById("report-password");
  var status = document.getElementById("unlock-status");
  var payloadPath = document.body.getAttribute("data-payload");

  if (!form || !passwordInput || !payloadPath) {
    return;
  }

  function setStatus(message) {
    if (status) {
      status.textContent = message;
    }
  }

  function decodeBase64(value) {
    var binary = atob(value);
    var bytes = new Uint8Array(binary.length);

    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  function deriveKey(password, salt, iterations) {
    var encoder = new TextEncoder();

    return crypto.subtle
      .importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"])
      .then(function (baseKey) {
        return crypto.subtle.deriveKey(
          {
            name: "PBKDF2",
            salt: salt,
            iterations: iterations,
            hash: "SHA-256",
          },
          baseKey,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"]
        );
      });
  }

  function decryptPayload(payload, password) {
    var salt = decodeBase64(payload.salt);
    var iv = decodeBase64(payload.iv);
    var ciphertext = decodeBase64(payload.ciphertext);

    return deriveKey(password, salt, payload.iterations).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ciphertext);
    });
  }

  function showReport(html) {
    var iframe = document.createElement("iframe");

    iframe.className = "report-frame";
    iframe.title = document.title;
    iframe.srcdoc = html;
    document.body.classList.add("is-unlocked");
    document.body.appendChild(iframe);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var password = passwordInput.value;

    if (!password) {
      setStatus("비밀번호를 입력하세요.");
      return;
    }

    setStatus("복호화 중입니다.");
    form.querySelector("button").disabled = true;

    fetch(payloadPath)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("payload");
        }
        return response.json();
      })
      .then(function (payload) {
        return decryptPayload(payload, password);
      })
      .then(function (plaintext) {
        var decoder = new TextDecoder();

        showReport(decoder.decode(plaintext));
      })
      .catch(function () {
        form.querySelector("button").disabled = false;
        setStatus("열 수 없습니다. 비밀번호를 확인하세요.");
      });
  });
})();
