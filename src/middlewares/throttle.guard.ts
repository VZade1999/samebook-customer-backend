import { ThrottlerGuard } from '@nestjs/throttler';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    console.log('[IPS]', req.headers['x-forwarded-for'], req?.ip, req.ip);

    // By default, the Application Load Balancer stores the IP address of the client in the X-Forwarded-For request header
    // and passes the header to your server. If the X-Forwarded-For request header is not included in the original request,
    // the load balancer creates one with the client IP address as the request value. Otherwise, the load balancer adds the client IP address
    // to the existing header and then passes the header to your server. The X-Forwarded-For request header may contain multiple IP addresses
    // that are comma separated. The left-most address is the client IP address where the request was first made.
    // This is followed by any subsequent proxy identifiers in a chain.
    return req.headers['x-forwarded-for']; // individualize IP extraction to meet your own needs
  }
}
