import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as Toast from "@radix-ui/react-toast";

let dispatchToast = null;

function ToastHost() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState("success");
  const reopenTimerRef = useRef(0);

  useEffect(() => {
    dispatchToast = (nextMessage, nextTone = "success") => {
      setMessage(String(nextMessage || ""));
      setTone(nextTone === "error" || nextTone === "info" ? nextTone : "success");
      setOpen(false);
      window.clearTimeout(reopenTimerRef.current);
      reopenTimerRef.current = window.setTimeout(() => setOpen(true), 20);
    };

    return () => {
      dispatchToast = null;
      window.clearTimeout(reopenTimerRef.current);
    };
  }, []);

  return (
    <Toast.Provider duration={1800} swipeDirection="right">
      <Toast.Root
        open={open}
        onOpenChange={setOpen}
        className={`np-toast np-toast--${tone}`}
      >
        <Toast.Title className="np-toast__title">{message}</Toast.Title>
      </Toast.Root>
      <Toast.Viewport className="np-toast__viewport" />
    </Toast.Provider>
  );
}

export function mountToastHost() {
  const mountPoint = document.createElement("div");
  mountPoint.id = "np-toast-host";
  document.body.append(mountPoint);
  render(<ToastHost />, mountPoint);
}

export function showToast(message, tone = "success") {
  if (typeof dispatchToast === "function") {
    dispatchToast(message, tone);
  }
}
