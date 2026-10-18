package io.github.rajatjc.loonie.payments;

import org.springframework.http.HttpStatus;

/** An error the API reports to the caller with a specific status. */
class ApiException extends RuntimeException {
    final HttpStatus status;

    ApiException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }
}
