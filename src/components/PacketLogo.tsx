import { Link } from "react-router-dom";

export function PacketLogo() {
  return (
    <Link className="packet-logo" to="/" aria-label="Packet Journey home">
      <span className="packet-logo__mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        Packet <b>Journey</b>
      </span>
    </Link>
  );
}
